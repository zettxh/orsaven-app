import type paper from "paper";

type ClipShape = Element;

export async function normalizeEvenoddClip(shape: ClipShape) {
  const tag = shape.localName;
  if (["rect", "circle", "ellipse"].includes(tag)) {
    shape.setAttribute("clip-rule", "nonzero");
    shape.setAttribute("fill-rule", "nonzero");
    return;
  }

  const { default: paperModule } = await import("paper");
  const scope = new paperModule.PaperScope();
  let source: paper.CompoundPath | undefined;
  let result: paper.PathItem | undefined;
  try {
    let data = shape.getAttribute("d") || "";
    if (tag === "polygon" || tag === "polyline") {
      const points = (shape.getAttribute("points") || "").trim().split(/[\s,]+/).filter(Boolean);
      if (points.length < 2 || points.length % 2 !== 0) throw new Error("Invalid evenodd clip points");
      data = `M${points[0]} ${points[1]} ${points.slice(2).join(" ")} Z`;
    } else if (tag !== "path") {
      throw new Error(`Unsupported evenodd clip shape: ${tag}`);
    }
    scope.setup(new scope.Size(1, 1));
    source = new scope.CompoundPath({ pathData: data, fillRule: "evenodd", insert: false });
    source.closed = true;
    result = source.unite(source, { insert: false });
    result.reorient(false, true);
    const output = result.exportSVG({ asString: true, precision: 12 });
    if (typeof output !== "string") throw new Error("Paper failed to serialize evenodd clip");
    const parsed = new DOMParser().parseFromString(output, "image/svg+xml").documentElement;
    const pathData = parsed.getAttribute("d");
    if (!pathData || ((result instanceof scope.Path || result instanceof scope.CompoundPath) && result.area === 0)) {
      const clip = shape.closest("clipPath");
      const id = clip?.getAttribute("id");
      if (!id) throw new Error("Empty evenodd clip has no ID");
      const reference = `url(#${id})`;
      for (const owner of [...shape.ownerDocument.querySelectorAll("[clip-path]")]) {
        if (owner.getAttribute("clip-path") === reference) owner.remove();
      }
      return;
    }
    if (shape.localName === "path") shape.setAttribute("d", pathData);
    else replaceWithPath(shape, pathData);
    shape.setAttribute("clip-rule", "nonzero");
    shape.setAttribute("fill-rule", "nonzero");
  } finally {
    result?.remove();
    source?.remove();
    scope.project?.remove();
  }
}

function replaceWithPath(shape: ClipShape, data: string) {
  const path = shape.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
  for (const attribute of [...shape.attributes]) {
    if (attribute.name !== "points" && attribute.name !== "fill-rule") path.setAttribute(attribute.name, attribute.value);
  }
  path.setAttribute("d", data);
  path.setAttribute("clip-rule", "nonzero");
  path.setAttribute("fill-rule", "nonzero");
  shape.replaceWith(path);
}
