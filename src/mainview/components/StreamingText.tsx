import { CodeBlockRenderer } from "./CodeBlockRenderer";

interface StreamingTextProps {
  text: string;
}

export function StreamingText({ text }: StreamingTextProps) {
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed">
      <CodeBlockRenderer text={text} hideCodeBlocks />
      <span className="inline-block w-[2px] h-[14px] bg-neon-cyan ml-0.5 animate-glow-pulse align-middle" />
    </div>
  );
}
