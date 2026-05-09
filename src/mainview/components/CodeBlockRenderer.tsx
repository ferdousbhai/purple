interface CodeBlockRendererProps {
  hideCodeBlocks?: boolean;
  text: string;
}

const FENCED_CODE_BLOCK = /(```[\s\S]*?```|```[\s\S]*$)/g;

function parseCodeBlock(raw: string): string {
  return raw
    .replace(/^```[^\n]*\n?/, "")
    .replace(/```$/, "")
    .trim();
}

export function visibleTextWithoutCodeBlocks(text: string): string {
  return text.replace(FENCED_CODE_BLOCK, "").trimEnd();
}

export function CodeBlockRenderer({
  hideCodeBlocks = false,
  text,
}: CodeBlockRendererProps) {
  if (hideCodeBlocks) {
    return (
      <span className="whitespace-pre-wrap">
        {visibleTextWithoutCodeBlocks(text)}
      </span>
    );
  }

  const parts = text.split(FENCED_CODE_BLOCK).filter(Boolean);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          return (
            <pre
              key={i}
              className="my-2 p-3 bg-black/40 rounded border border-neon-lime/10
                text-neon-lime/80 font-mono text-xs overflow-x-auto
                shadow-[inset_0_0_20px_#39ff1408]"
            >
              {parseCodeBlock(part)}
            </pre>
          );
        }
        return (
          <span key={i} className="whitespace-pre-wrap">
            {part}
          </span>
        );
      })}
    </>
  );
}
