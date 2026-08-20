import { visibleTextWithoutCodeBlocks } from "@purple/core/pattern";

interface CodeBlockRendererProps {
  text: string;
}

export function CodeBlockRenderer({ text }: CodeBlockRendererProps) {
  return (
    <span className="whitespace-pre-wrap">
      {visibleTextWithoutCodeBlocks(text)}
    </span>
  );
}
