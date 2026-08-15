interface CodeBlockRendererProps {
  text: string;
}

const FENCED_CODE_BLOCK = /(```[\s\S]*?```|```[\s\S]*$)/g;

export function visibleTextWithoutCodeBlocks(text: string): string {
  return text.replace(FENCED_CODE_BLOCK, "").trim();
}

export function CodeBlockRenderer({ text }: CodeBlockRendererProps) {
  return (
    <span className="whitespace-pre-wrap">
      {visibleTextWithoutCodeBlocks(text)}
    </span>
  );
}
