import { visibleTextWithoutCodeBlocks } from "./CodeBlockRenderer";

interface StreamingTextProps {
  text: string;
}

const DOT_DELAYS_MS = [0, 120, 240];

export function StreamingText({ text }: StreamingTextProps) {
  if (!text) {
    return (
      <div className="h-5 flex items-center">
        <span
          aria-label="Waiting for response"
          className="inline-flex items-center gap-1 text-neon-cyan/60"
        >
          {DOT_DELAYS_MS.map((delay) => (
            <span
              key={delay}
              aria-hidden="true"
              className="size-1 rounded-full bg-current animate-bounce motion-reduce:animate-none"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
      </div>
    );
  }

  const visibleText = visibleTextWithoutCodeBlocks(text);

  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed">
      {visibleText || (
        <span className="font-mono text-xs uppercase tracking-widest text-neon-cyan/60">
          Writing pattern
        </span>
      )}
      <span className="inline-block w-[2px] h-[14px] bg-neon-cyan ml-0.5 animate-glow-pulse align-middle" />
    </div>
  );
}
