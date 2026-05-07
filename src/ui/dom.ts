type AttrValue =
  | string
  | number
  | boolean
  | EventListener
  | Record<string, string | number | undefined>
  | null
  | undefined;

type Child = Node | string | number | boolean | null | undefined;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  children: Child[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }

    if (name === "className") {
      node.className = String(value);
      continue;
    }

    if (name === "dataset" && isRecord(value)) {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        if (dataValue !== undefined) {
          node.dataset[dataKey] = String(dataValue);
        }
      }
      continue;
    }

    if (name.startsWith("on") && typeof value === "function") {
      node.addEventListener(name.slice(2).toLowerCase(), value);
      continue;
    }

    if (value === true) {
      node.setAttribute(name, "");
    } else {
      node.setAttribute(name, String(value));
    }
  }

  node.append(...children.flatMap(childToNode));
  return node;
}

export function clear(node: Node): void {
  node.textContent = "";
}

function childToNode(child: Child): Node[] {
  if (child === null || child === undefined || child === false) {
    return [];
  }

  if (child instanceof Node) {
    return [child];
  }

  return [document.createTextNode(String(child))];
}

function isRecord(value: AttrValue): value is Record<string, string | number | undefined> {
  return typeof value === "object" && value !== null;
}
