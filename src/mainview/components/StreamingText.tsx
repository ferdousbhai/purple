import { visibleTextWithoutCodeBlocks } from "./CodeBlockRenderer";

interface StreamingTextProps {
  text: string;
}

export function StreamingText({ text }: StreamingTextProps) {
  const visibleText = visibleTextWithoutCodeBlocks(text);

  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed">
      {visibleText || (
        <span className="font-mono text-xs uppercase tracking-widest text-neon-cyan/60">
          {text ? "Writing pattern" : "Composing"}
        </span>
      )}
      <span className="inline-block w-[2px] h-[14px] bg-neon-cyan ml-0.5 animate-glow-pulse align-middle" />
    </div>
  );
}
