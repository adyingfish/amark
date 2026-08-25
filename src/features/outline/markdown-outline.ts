export interface MarkdownOutlineItem {
  level: number;
  text: string;
  line: number;
  offset: number;
  headingIndex: number;
}

function headingText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\\([\\`*{}[\]()#+\-.!_>~|])/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

function withoutCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

export function extractMarkdownOutline(markdown: string): MarkdownOutlineItem[] {
  const lines = markdown.split("\n");
  const offsets: number[] = [];
  const outline: MarkdownOutlineItem[] = [];
  let offset = 0;
  let fence: { character: "`" | "~"; length: number } | null = null;
  let headingIndex = 0;

  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = withoutCarriageReturn(lines[index]);
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);

    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence.character &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2].trim() === ""
      ) {
        fence = null;
      }
      continue;
    }

    if (fenceMatch) {
      fence = {
        character: fenceMatch[1][0] as "`" | "~",
        length: fenceMatch[1].length,
      };
      continue;
    }

    const atxMatch = line.match(/^ {0,3}(#{1,6})(?:[\t ]+(.*)|[\t ]*)$/);
    if (atxMatch) {
      const text = headingText((atxMatch[2] ?? "").replace(/[\t ]+#+[\t ]*$/, ""));
      if (text) {
        outline.push({
          level: atxMatch[1].length,
          text,
          line: index + 1,
          offset: offsets[index],
          headingIndex,
        });
      }
      headingIndex += 1;
      continue;
    }

    const underlineMatch = lines[index + 1]
      ? withoutCarriageReturn(lines[index + 1]).match(/^ {0,3}(=+|-+)[\t ]*$/)
      : null;
    const text = headingText(line);
    if (underlineMatch && text) {
      outline.push({
        level: underlineMatch[1][0] === "=" ? 1 : 2,
        text,
        line: index + 1,
        offset: offsets[index],
        headingIndex,
      });
      headingIndex += 1;
      index += 1;
    }
  }

  return outline;
}
