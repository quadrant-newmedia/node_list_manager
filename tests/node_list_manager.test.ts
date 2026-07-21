import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NodeListManager } from "../src/node_list_manager.js";

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------

type ItemData = { key: string; text: string };

class TestManager extends NodeListManager<ItemData, HTMLElement, string> {
    get_key(data: ItemData): string {
        return data.key;
    }
    create_component(key: string): HTMLElement {
        const el = document.createElement("div");
        el.dataset["key"] = key;
        return el;
    }
    update_component(component: HTMLElement, data: ItemData): void {
        component.textContent = data.text;
    }
    get_node(component: HTMLElement): Node {
        return component;
    }
}

function item(key: string, text = key): ItemData {
    return { key, text };
}

// ---------------------------------------------------------------------------
// Mixed-node fixture
// A manager whose components hold either a Text node or an HTMLSpanElement,
// chosen by the "node_type" field of MixedItemData.
// ---------------------------------------------------------------------------

type MixedItemData = {
    key: string;
    node_type: "text" | "element";
    content: string;
};

type MixedComponent = Text | HTMLSpanElement;

class MixedNodeManager extends NodeListManager<
    MixedItemData,
    MixedComponent,
    string
> {
    get_key(data: MixedItemData): string {
        return `${data.node_type}-${data.key}`;
    }
    create_component(key: string): MixedComponent {
        if (key.startsWith("text")) return document.createTextNode("");
        return document.createElement("span");
    }
    update_component(component: MixedComponent, data: MixedItemData): void {
        component.textContent = data.content;
    }
    get_node(component: MixedComponent): Node {
        return component;
    }
}

function mixedItem(
    key: string,
    node_type: "text" | "element",
    content = key,
): MixedItemData {
    return { key, node_type, content };
}

/** Returns the data-key of each managed child element, in DOM order. */
function childKeys(el: Element): string[] {
    return Array.from(el.children).map(
        (c) => (c as HTMLElement).dataset["key"] ?? "",
    );
}

const NO_ANCHORS = { start_anchor: null, end_anchor: null };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NodeListManager", () => {
    let manager: TestManager;
    let container: HTMLDivElement;

    beforeEach(() => {
        manager = new TestManager();
        container = document.createElement("div");
    });

    // -----------------------------------------------------------------------
    // Core sync_to behaviour
    // -----------------------------------------------------------------------

    describe("sync_to", () => {
        it("creates nodes on initial render", () => {
            manager.sync_to(
                container,
                [item("a"), item("b"), item("c")],
                NO_ANCHORS,
            );

            expect(childKeys(container)).toEqual(["a", "b", "c"]);
        });

        it("appends new nodes and reuses existing ones", () => {
            manager.sync_to(container, [item("a"), item("b")], NO_ANCHORS);
            const nodeA = container.children[0];
            const nodeB = container.children[1];

            manager.sync_to(
                container,
                [item("a"), item("b"), item("c")],
                NO_ANCHORS,
            );

            expect(childKeys(container)).toEqual(["a", "b", "c"]);
            expect(container.children[0]).toBe(nodeA); // same instance — reused
            expect(container.children[1]).toBe(nodeB);
        });

        it("removes nodes no longer in the list", () => {
            manager.sync_to(
                container,
                [item("a"), item("b"), item("c")],
                NO_ANCHORS,
            );
            const nodeA = container.children[0];
            const nodeC = container.children[2];

            manager.sync_to(container, [item("a"), item("c")], NO_ANCHORS);

            expect(childKeys(container)).toEqual(["a", "c"]);
            expect(container.children[0]).toBe(nodeA);
            expect(container.children[1]).toBe(nodeC);
        });

        it("updates existing nodes without recreating them", () => {
            manager.sync_to(container, [item("a", "old text")], NO_ANCHORS);
            const nodeA = container.children[0];

            manager.sync_to(container, [item("a", "new text")], NO_ANCHORS);

            expect(container.children.length).toBe(1);
            expect(container.children[0]).toBe(nodeA); // same instance — not recreated
            expect(container.children[0].textContent).toBe("new text");
        });

        it("reorders nodes", () => {
            manager.sync_to(
                container,
                [item("a"), item("b"), item("c")],
                NO_ANCHORS,
            );
            const [nodeA, nodeB, nodeC] = Array.from(container.children);

            manager.sync_to(
                container,
                [item("c"), item("a"), item("b")],
                NO_ANCHORS,
            );

            expect(childKeys(container)).toEqual(["c", "a", "b"]);
            expect(container.children[0]).toBe(nodeC);
            expect(container.children[1]).toBe(nodeA);
            expect(container.children[2]).toBe(nodeB);
        });

        it("handles inserts, removals, and reorders in a single sync", () => {
            manager.sync_to(
                container,
                [item("a"), item("b"), item("c")],
                NO_ANCHORS,
            );

            // remove b, add d, reorder remaining
            manager.sync_to(
                container,
                [item("c"), item("d"), item("a")],
                NO_ANCHORS,
            );

            expect(childKeys(container)).toEqual(["c", "d", "a"]);
        });

        it("removes all managed children when synced to an empty list", () => {
            manager.sync_to(container, [item("a"), item("b")], NO_ANCHORS);

            manager.sync_to(container, [], NO_ANCHORS);

            expect(container.children.length).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Anchor support
    // -----------------------------------------------------------------------

    describe("anchor support", () => {
        it("does not touch nodes before start_anchor", () => {
            const before = document.createElement("span");
            container.appendChild(before);
            const startAnchor = document.createElement("hr");
            container.appendChild(startAnchor);

            manager.sync_to(container, [item("a"), item("b")], {
                start_anchor: startAnchor,
                end_anchor: null,
            });

            expect(container.children[0]).toBe(before);
            expect(container.children[1]).toBe(startAnchor);
        });

        it("does not touch nodes after end_anchor", () => {
            const endAnchor = document.createElement("hr");
            container.appendChild(endAnchor);
            const after = document.createElement("span");
            container.appendChild(after);

            manager.sync_to(container, [item("a")], {
                start_anchor: null,
                end_anchor: endAnchor,
            });

            const children = Array.from(container.children);
            expect(children.at(-1)).toBe(after);
            expect(children.indexOf(endAnchor)).toBeLessThan(
                children.indexOf(after),
            );
        });

        it("manages only the region between both anchors", () => {
            const startAnchor = document.createElement("hr");
            container.appendChild(startAnchor);
            const endAnchor = document.createElement("hr");
            container.appendChild(endAnchor);
            const after = document.createElement("span");
            container.appendChild(after);

            manager.sync_to(container, [item("a"), item("b")], {
                start_anchor: startAnchor,
                end_anchor: endAnchor,
            });

            const children = Array.from(container.children);
            expect(children[0]).toBe(startAnchor);
            expect(children.at(-1)).toBe(after);
            const managed = children.slice(
                children.indexOf(startAnchor) + 1,
                children.indexOf(endAnchor),
            );
            expect(
                managed.map((c) => (c as HTMLElement).dataset["key"]),
            ).toEqual(["a", "b"]);
        });

        it("throws if start_anchor is not a child of container", () => {
            const notAChild = document.createElement("div");

            expect(() => {
                manager.sync_to(container, [], {
                    start_anchor: notAChild,
                    end_anchor: null,
                });
            }).toThrow("start_anchor is not a child of container");
        });

        it("throws if end_anchor is not a child of container", () => {
            const notAChild = document.createElement("div");

            expect(() => {
                manager.sync_to(container, [], {
                    start_anchor: null,
                    end_anchor: notAChild,
                });
            }).toThrow("end_anchor is not a child of container");
        });
    });

    // -----------------------------------------------------------------------
    // Focus preservation
    // -----------------------------------------------------------------------

    describe("focus preservation", () => {
        beforeEach(() => {
            // Element must be attached to the document for focus() to work.
            document.body.appendChild(container);
        });

        afterEach(() => {
            container.remove();
        });

        it("preserves focus when the focused node moves from first to second (last)", () => {
            manager.sync_to(container, [item("a"), item("b")], NO_ANCHORS);

            const nodeA =
                container.querySelector<HTMLElement>('[data-key="a"]')!;
            nodeA.tabIndex = 0;
            nodeA.focus();
            expect(document.activeElement).toBe(nodeA);

            // a is currently first; reorder so a ends up second (last)
            manager.sync_to(container, [item("b"), item("a")], NO_ANCHORS);

            expect(document.activeElement).toBe(nodeA); // focus must be preserved
            expect(childKeys(container)).toEqual(["b", "a"]); // order must be correct
        });

        it("preserves focus when the focused node moves from second (last) to first", () => {
            manager.sync_to(container, [item("a"), item("b")], NO_ANCHORS);

            const nodeB =
                container.querySelector<HTMLElement>('[data-key="b"]')!;
            nodeB.tabIndex = 0;
            nodeB.focus();
            expect(document.activeElement).toBe(nodeB);

            // b is currently second; reorder so b ends up first
            manager.sync_to(container, [item("b"), item("a")], NO_ANCHORS);

            expect(document.activeElement).toBe(nodeB); // focus must be preserved
            expect(childKeys(container)).toEqual(["b", "a"]); // order must be correct
        });
    });

    // -----------------------------------------------------------------------
    // Mixed Text / Element children
    // -----------------------------------------------------------------------

    describe("mixed Text and Element nodes", () => {
        let mixedManager: MixedNodeManager;
        let mixedContainer: HTMLDivElement;

        beforeEach(() => {
            mixedManager = new MixedNodeManager();
            mixedContainer = document.createElement("div");
        });

        it("renders a mix of Text and Element nodes in the correct order", () => {
            mixedManager.sync_to(
                mixedContainer,
                [
                    mixedItem("a", "text", "hello"),
                    mixedItem("b", "element"),
                    mixedItem("c", "text", "world"),
                ],
                NO_ANCHORS,
            );

            expect(mixedContainer.childNodes.length).toBe(3);
            expect(mixedContainer.childNodes[0]).toBeInstanceOf(Text);
            expect(mixedContainer.childNodes[0].textContent).toBe("hello");
            expect(mixedContainer.childNodes[1]).toBeInstanceOf(
                HTMLSpanElement,
            );
            expect(mixedContainer.childNodes[1].textContent).toBe("b");
            expect(mixedContainer.childNodes[2]).toBeInstanceOf(Text);
            expect(mixedContainer.childNodes[2].textContent).toBe("world");
        });

        it("leaves mixed before/after sibling nodes untouched while managing the region between anchors", () => {
            // Before region: a Text node followed by a <b> element
            const beforeText = document.createTextNode("before-text");
            mixedContainer.appendChild(beforeText);
            const beforeEl = document.createElement("b");
            beforeEl.textContent = "before-el";
            mixedContainer.appendChild(beforeEl);

            const startAnchor = document.createElement("hr");
            mixedContainer.appendChild(startAnchor);

            const endAnchor = document.createElement("hr");
            mixedContainer.appendChild(endAnchor);

            // After region: a <i> element followed by a Text node
            const afterEl = document.createElement("i");
            afterEl.textContent = "after-el";
            mixedContainer.appendChild(afterEl);
            const afterText = document.createTextNode("after-text");
            mixedContainer.appendChild(afterText);

            // First sync: managed region gets a Text node and a span
            mixedManager.sync_to(
                mixedContainer,
                [
                    mixedItem("x", "text", "managed-text"),
                    mixedItem("y", "element", "managed-el"),
                ],
                { start_anchor: startAnchor, end_anchor: endAnchor },
            );

            const allNodes = Array.from(mixedContainer.childNodes);
            // Before-region nodes are intact
            expect(allNodes[0]).toBe(beforeText);
            expect(allNodes[1]).toBe(beforeEl);
            // Anchors are intact
            expect(allNodes[2]).toBe(startAnchor);
            // Managed nodes are between the anchors
            expect(allNodes[3]).toBeInstanceOf(Text);
            expect(allNodes[3].textContent).toBe("managed-text");
            expect(allNodes[4]).toBeInstanceOf(HTMLSpanElement);
            expect(allNodes[4].textContent).toBe("managed-el");
            expect(allNodes[5]).toBe(endAnchor);
            // After-region nodes are intact
            expect(allNodes[6]).toBe(afterEl);
            expect(allNodes[7]).toBe(afterText);
        });

        it("reorders, adds, and removes mixed nodes in a single sync", () => {
            mixedManager.sync_to(
                mixedContainer,
                [
                    mixedItem("a", "text", "alpha"),
                    mixedItem("b", "element", "beta"),
                    mixedItem("c", "element", "gamma"),
                ],
                NO_ANCHORS,
            );

            const nodeA = mixedContainer.childNodes[0]; // Text
            const nodeC = mixedContainer.childNodes[2]; // span[key=c]

            // Remove b, add d (text), reorder: c first, then a, then d
            mixedManager.sync_to(
                mixedContainer,
                [
                    mixedItem("c", "element", "gamma"),
                    mixedItem("a", "text", "alpha"),
                    mixedItem("d", "text", "delta"),
                ],
                NO_ANCHORS,
            );

            expect(mixedContainer.childNodes.length).toBe(3);
            expect(mixedContainer.childNodes[0]).toBe(nodeC);
            expect(mixedContainer.childNodes[1]).toBe(nodeA);
            expect(mixedContainer.childNodes[2]).toBeInstanceOf(Text);
            expect(mixedContainer.childNodes[2].textContent).toBe("delta");
        });
    });
});
