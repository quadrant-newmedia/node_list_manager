/**
    A class for managing a list of child nodes.

    You tell us how to create/update children given an instance of DataType. When you want us to "render" to a container, you give us a list of DataType (aka the "data list").

    By updating the data list and then calling sync_to, we automatically :
    - insert nodes
    - remove nodes
    - reorder nodes
    - update nodes

    DataType and ComponentType can be anything at all. We don't __do__ anything with instances of these types other than pass them to the abstract functions. 
    
    DataType will usually be a simple/dumb data structure.

    ComponentType can just be Node for simple managers of "simple children". For more complex child structures, ComponentType might be a wrapper with references to multiple elements within the rendered child. This makes it easier to update specific elements in `update_component`.

    KeyType instances are used as keys in a Map. You can use object type keys, but then they'll be compared by identity (reference). We recommend using string or number keys.

    Note that if a call to sync_to matches these criteria:
    - it results in a reordering of children
    - one of the children is already present in the container and contains document.activeElement
    Then we guarantee that we will NOT (even temporarily) remove that child from the DOM. We'll move the other child nodes around it. This means focus state won't be lost.
 */
export abstract class NodeListManager<DataType, ComponentType, KeyType> {
    /** Must be unique for each element in the `items` you pass to `sync_to`. Must be stable over time if you want a child component to be reused. */
    abstract get_key(data: DataType): KeyType;
    /** Create a new component with the given key. The component's key will never be changed. We'll call update_component on the result before it is first used. */
    abstract create_component(key: KeyType): ComponentType;
    /** Update the component's dom nodes to match the current data. */
    abstract update_component(component: ComponentType, data: DataType): void;
    /** Extract the Node. This is the only portion of ComponentType we care about.  */
    abstract get_node(component: ComponentType): Node;

    private component_map: Map<KeyType, ComponentType> = new Map();

    /**
        Update container's children (between start_anchor and end_anchor), so that they correspond to components created from `items`.

        Note that if one of the "managed nodes" currently contains the focused element and will still exist after we return, then we guarantee that that node will NOT be removed from the DOM (even temporarily) during our execution. We'll move other elements around it, instead.
     */
    sync_to(
        container: Element,
        items: DataType[],
        options: {
            start_anchor: Node | null;
            end_anchor: Node | null;
        },
    ) {
        const start_anchor = options.start_anchor ?? null;
        const end_anchor: Node | null = options.end_anchor ?? null;

        if (start_anchor && start_anchor.parentNode != container)
            throw new Error(`start_anchor is not a child of container`);
        if (end_anchor && end_anchor.parentNode != container)
            throw new Error(`end_anchor is not a child of container`);

        // Create or update components for every incoming item
        const new_keys = new Set<KeyType>();
        const desired_nodes: Node[] = [];

        for (const item of items) {
            const key = this.get_key(item);
            new_keys.add(key);
            let component = this.component_map.get(key);
            if (component === undefined) {
                component = this.create_component(key);
                this.component_map.set(key, component);
            }
            this.update_component(component, item);
            desired_nodes.push(this.get_node(component));
        }

        // Remove components that are no longer present
        for (const [key, component] of this.component_map) {
            if (!new_keys.has(key)) {
                const node = this.get_node(component);
                node.parentNode?.removeChild(node);
                this.component_map.delete(key);
            }
        }

        set_child_nodes(container, start_anchor, end_anchor, desired_nodes);
    }
}

/**
    Ensure that container's children between start_anchor and end_anchor are equal to desired_child_nodes.
    Leave all children up to and including start_anchor alone.
    Leave all children including and after end_anchor alone.
    Ensure that if one of the "managed children" currently has focus, it is NEVER removed from the DOM (other siblings will be moved around it).
 */
function set_child_nodes(
    container: Element,
    start_anchor: Node | null,
    end_anchor: Node | null,
    desired_nodes: Node[],
) {
    if (start_anchor && start_anchor.parentNode != container)
        throw new Error(`start_anchor is not a child of container`);
    if (end_anchor && end_anchor.parentNode != container)
        throw new Error(`end_anchor is not a child of container`);

    const current_children_set = new Set<Node>(
        nodes_between(container, start_anchor, end_anchor),
    );
    const desired_child_nodes_set = new Set<Node>(desired_nodes);

    const focused_node = get_focused_node(container);

    // Remove unwanted children from managed section
    let cursor = start_anchor?.nextSibling ?? container.firstChild;
    while (cursor && cursor != end_anchor) {
        const next_node = cursor.nextSibling;
        if (!desired_child_nodes_set.has(cursor)) cursor.remove();
        cursor = next_node;
    }

    // Add new children at end of managed section
    for (const child of desired_nodes) {
        if (!current_children_set.has(child)) {
            container.insertBefore(child, end_anchor);
        }
    }

    /*
        fix order of managed section, being sure to never move any node containing document.activeElement
        loop invariants (at time of entry):
        - container contains the correct SET of children
        - all children before cursor_node are already in order
        - cursor_node's position in the "managed children" is equal to managed_child_index
    */
    cursor = start_anchor?.nextSibling ?? container.firstChild;
    let managed_child_index = 0;
    while (cursor && cursor != end_anchor) {
        const desired_node = desired_nodes[managed_child_index];
        if (!desired_node)
            throw new Error(
                "Loop invariant violated. Our implementation needs review.",
            );

        if (cursor == desired_node) {
            cursor = cursor.nextSibling;
            managed_child_index += 1;
        } else {
            if (focused_node && desired_node.contains(focused_node)) {
                /*
                    desired_node cannot be moved. We have to move cursor_node instead.
                    We'll move cursor_node to after desired_node, and leave the cursors pointing at the same position.
                */
                const next_cursor_node = cursor.nextSibling;
                container.insertBefore(cursor, desired_node.nextSibling);
                cursor = next_cursor_node;
                // do NOT update managed_child_index; the new cursor_node is in the same position that the previous one was
            } else {
                container.insertBefore(desired_node, cursor);
                managed_child_index += 1;
            }
        }
    }
}

function get_focused_node(container: Node): Node | null {
    const root_node = container.getRootNode();

    // don't naively use document.activeElement; container may be inside a ShadowRoot
    if (root_node instanceof Document || root_node instanceof ShadowRoot)
        return root_node.activeElement;
    return null;
}

/**
    Assumes start_anchor and end_anchor, if defined, are children of container
 */
function nodes_between(
    container: Node,
    start_anchor: Node | null,
    end_anchor: Node | null,
) {
    const result: Node[] = [];
    let cursor = start_anchor?.nextSibling ?? container.firstChild;
    while (cursor && cursor != end_anchor) {
        result.push(cursor);
        cursor = cursor.nextSibling;
    }
    return result;
}
