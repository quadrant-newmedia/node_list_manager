# NodeListManager

A TypeScript utility for efficiently managing a list of DOM child nodes driven by a data array. Handles insertion, removal, reordering, and updates automatically — while preserving focus state.

## Overview

`NodeListManager` is an abstract class that maps an array of data items to a set of DOM nodes inside a container. Call `sync_to` whenever your data changes, and it will reconcile the DOM to match.

```typescript
abstract class NodeListManager<DataType, ComponentType, KeyType>
```

| Type Parameter  | Description |
|-----------------|-------------|
| `DataType`      | Your data structure (usually a plain object) |
| `ComponentType` | Your component wrapper (can be _Node_ for simple cases). Should hold references to whatever elements need to be updated by the _update_component_ method |
| `KeyType`       | A stable, unique key — prefer _string_ or _number_ |

## Abstract Methods

Subclasses must implement these four methods:

```typescript
// Return a unique, stable key for a data item
abstract get_key(data: DataType): KeyType;

// Create a new component for the given key
abstract create_component(key: KeyType): ComponentType;

// Update a component's DOM to reflect current data
abstract update_component(component: ComponentType, data: DataType): void;

// Extract the root Node from a component
abstract get_node(component: ComponentType): Node;
```

## Concrete method: `sync_to`

```typescript
sync_to(
    container: Element,
    items: DataType[],
    options: {
        start_anchor: Node | null;
        end_anchor: Node | null;
    }
): void
```

Reconciles *container*'s children to match *items*. Only children between *start_anchor* and *end_anchor* are managed — nodes outside that range are left untouched. Pass *null* for either anchor to use the container's full child list.

**What it does on each call:**
- Creates components for new keys
- Updates all existing components
- Removes components whose keys are no longer present
- Reorders nodes to match the order of *items*

## Focus Preservation

If a managed node contains *document.activeElement* at the time of a *sync_to* call, that node will **never be temporarily removed from the DOM** — even during reordering. Sibling nodes are moved around it instead, so focus and input state are preserved.

## Example

```typescript
import { NodeListManager } from './src/node_list_manager';

interface Item {
    id: number;
    label: string;
}

class ItemListManager extends NodeListManager<Item, HTMLLIElement, number> {
    get_key(data: Item) { return data.id; }
    create_component(_key: number) { return document.createElement('li'); }
    update_component(node: HTMLLIElement, data: Item) { node.textContent = data.label; }
    get_node(node: HTMLLIElement) { return node; }
}

const manager = new ItemListManager();
const ul = document.querySelector('ul')!;

// Initial render
manager.sync_to(ul, [{ id: 1, label: 'One' }, { id: 2, label: 'Two' }], {
    start_anchor: null,
    end_anchor: null,
});

// Update — only changed nodes are touched
manager.sync_to(ul, [{ id: 2, label: 'Two' }, { id: 3, label: 'Three' }], {
    start_anchor: null,
    end_anchor: null,
});
```

## Shadow DOM Support

Focus detection is Shadow DOM-aware. When *container* is inside a *ShadowRoot*, *activeElement* is resolved against that shadow root rather than the top-level document.
