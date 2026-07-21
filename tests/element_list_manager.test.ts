import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NodeListManager } from "../src/element_list_manger.js";

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
});
