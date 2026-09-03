export interface ShowcasePattern {
  title: string;
  code: string;
}

/**
 * Complete, editable pieces shown to visitors who do not have a session yet.
 * Keep these inside Purple's safe Strudel surface and exercise them against
 * the real engine in packages/ui/src/strudel-examples.test.ts.
 */
export const SHOWCASE_PATTERNS: readonly ShowcasePattern[] = [
  {
    title: "Night Shift House",
    code: `stack(
  s("bd*4, [~ cp]*2, [~ hh]*4").bank("RolandTR909"),
  note("<c2 c2 g1 bb1>").s("sawtooth").lpf(sine.range(300, 1200).slow(8)).gain(.8)
).cpm(126/4)`,
  },
  {
    title: "Dub Signal Garden",
    code: `stack(
  note("[~ [<[d3,a3,f4]!2 [d3,bb3,g4]!2> ~]]*2").s("piano").delay(.5),
  s("bd rim").bank("RolandTR707").delay(.5),
  n("<4 [3@3 4] [<2 0> ~@16] ~>").scale("D4:minor").s("sawtooth").room(.5).gain(.4),
  n("[0 [~ 0] 4 [3 2] [0 ~] [0 ~] <0 2> ~]/2").scale("D2:minor").s("sawtooth,triangle").lpf(800)
).cpm(90/4)`,
  },
  {
    title: "Prismatic Plucks",
    code: `stack(
  n("0 [2 4] <3 5> [~ <4 1>]".add("<0 [0,2,4]>")).scale("C5:minor").s("pluck").room(.4).delay(.125),
  note("c2 [eb3,g3]".add("<0 <1 -1>>")).adsr("[.1 0]:.2:[1 0]").s("bass1").room(.5),
  n("0 1 [2 3] 2").s("jazz").jux(rev)
).cpm(96/4)`,
  },
];
