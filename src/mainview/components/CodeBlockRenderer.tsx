import { visibleTextWithoutCodeBlocks } from "@riff/core/pattern";

interface CodeBlockRendererProps {
  text: string;
}

export { visibleTextWithoutCodeBlocks } from "@riff/core/pattern";

export function CodeBlockRenderer({ text }: CodeBlockRendererProps) {
  return (
    <span className="whitespace-pre-wrap">
      {visibleTextWithoutCodeBlocks(text)}
    </span>
  );
}
