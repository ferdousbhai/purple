import type { ShowcasePattern } from "./showcase-patterns.ts";

/**
 * The opening set for the public gallery: one piece per room, each inside
 * Purple's safe Strudel surface and exercised against the real engine in
 * packages/ui/src/strudel-examples.test.ts. Loaded into D1 by
 * scripts/seed-patterns.mjs.
 */
export const SEED_PATTERNS: readonly ShowcasePattern[] = [
  {
    title: "First Light",
    code: `stack(
  note("<[c3,e3,g3,b3] [a2,e3,g3,c4] [f2,c3,e3,a3] [g2,d3,f3,b3]>/2").s("sawtooth").lpf(sine.rangex(300, 1400).slow(16)).attack(1.5).release(3).gain(.35).room(.8).roomsize(6),
  note("<c5 e5 g5 b5 a5 g5>/3").s("triangle").delay(".6:.375:.6").gain(.3).pan(sine.range(.2, .8).slow(7)),
  s("birds:2").slow(4).gain(.25).room(.9)
).cpm(60/4)`,
  },
  {
    title: "Warehouse 4AM",
    code: `stack(
  s("bd*4").bank("RolandTR909").gain(.9),
  s("[~ hh]*4").bank("RolandTR909").gain("[.5 .8]*4").cut(1),
  s("~ cp ~ cp").bank("RolandTR909").room(.3).gain(.6),
  note("<c1 c1 c1 [c1 eb1]>*4").s("sawtooth").lpf(saw.rangex(200, 1800).slow(16)).lpq(6).ftype("ladder").decay(.15).sustain(0).gain(.7),
  s("metal:3*8").hpf(3000).gain(perlin.range(.1, .35)).pan(rand)
).cpm(130/4)`,
  },
  {
    title: "Lagos Rooftop",
    code: `stack(
  s("bd ~ bd ~, ~ ~ rim ~, [~ hh]*4").bank("RolandTR707").gain(.8),
  s("perc:2 ~ perc:4 perc:1 ~ perc:3 ~ perc:5").gain(.5).pan("0.3 0.7").room(.2),
  note("<[e2 ~ e2 g2] [a2 ~ a2 b2]>").s("jvbass").lpf(900).gain(.8),
  n("<0 2 4 3> [~ 5] <7 6> ~".add("<0 2>")).scale("E4:minor").s("pluck").delay(.3).gain(.6).sometimes(x => x.add(note(12)))
).cpm(118/4)`,
  },
  {
    title: "Dub Echo Chamber",
    code: `stack(
  s("bd ~ ~ ~ bd ~ ~ ~, ~ ~ sd ~ ~ ~ sd ~").bank("RolandTR808").gain(.9),
  s("~ hh ~ hh").bank("RolandTR808").gain(.4).delay(".4:.33:.6"),
  note("<[g1 ~ ~ g1] [bb1 ~ f1 ~]>").s("bass2").lpf(400).gain(.9),
  chord("<Gm7 Gm7 F7 Gm7>").voicing().s("piano").struct("~ x ~ x").delay(".6:.375:.7").gain(.45).room(.5)
).cpm(75/4)`,
  },
  {
    title: "Amen Sunrise",
    code: `stack(
  s("breaks165").fit().chop(16).gain(.85).sometimesBy(.2, x => x.speed(-1)),
  s("bd ~ ~ bd ~ ~ bd ~").bank("RolandTR909").gain(.7),
  note("<g1 g1 [g1 bb1] f1>").s("jungbass:3").lpf(300).gain(.9).clip(.8),
  note("<[g3,bb3,d4] [f3,a3,c4]>/2").s("pad").attack(.5).release(2).gain(.3).room(.7).hpf(400)
).cpm(165/4)`,
  },
  {
    title: "Acid Corridor",
    code: `stack(
  s("bd*4, [~ oh]*2").bank("RolandTR808").gain(.85),
  s("hh*8").bank("RolandTR808").gain("[.4 .7]*4").cut(1),
  n("0 [0 7] 3 0 [5 0] 3 [0 12] 0".add("<0 0 3 -2>")).scale("A1:minor").s("sawtooth").lpf(sine.rangex(200, 2500).slow(8)).lpenv(4).lpq(9).ftype("ladder").decay(.12).sustain(.1).gain(.65).sometimes(x => x.add(note(12)))
).cpm(128/4)`,
  },
  {
    title: "Kyoto Rain",
    code: `stack(
  s("bd ~ [~ bd] ~, ~ sd ~ sd").bank("AkaiMPC60").gain(.8).swingBy(1/6, 4),
  s("hh*8").bank("AkaiMPC60").gain("[.35 .6 .4 .55]*2").swingBy(1/6, 8).cut(1),
  chord("<Dm9 G13 C^9 Am9>").voicing().s("piano").room(.6).lpf(2200).gain(.5).add(note(perlin.range(0, .3))),
  note("<d2 g2 c2 a1>").s("bass1").lpf(500).gain(.8),
  s("wind:1").slow(8).gain(.2).hpf(600)
).cpm(82/4)`,
  },
  {
    title: "Garage Skip",
    code: `stack(
  s("bd ~ ~ bd ~ ~ bd ~").bank("RolandTR909").gain(.85),
  s("~ cp ~ cp").bank("RolandTR909").gain(.6).room(.2),
  s("[~ hh] [hh ~] [~ hh] [hh oh]").bank("RolandTR909").gain(.5).swingBy(1/5, 8).cut(1),
  note("<[e2 ~ e2 ~] [~ g2 ~ b1]>").s("bass3").lpf(600).gain(.85),
  n("<[7 ~ 5 ~] [~ 4 ~ 2]>".add("<0 0 -3 2>")).scale("E3:minor").s("square").lpf(1200).decay(.2).sustain(0).delay(".3:.1875:.5").gain(.4),
  note("<b4 ~ ~ [g4 e4]>").s("sax:2").gain(.3).room(.5).sometimes(x => x.hurry(.5))
).cpm(132/4)`,
  },
  {
    title: "Tokyo Arcade",
    code: `stack(
  n("0 4 7 12 7 4 <2 3> 0".add("<0 5 3 -2>")).scale("C4:major").s("z_square").decay(.1).sustain(.2).gain(.45).delay(".25:.125:.3"),
  note("<c2 f2 g2 a2>*2").s("z_triangle").gain(.6),
  s("sbd*4, ~ [white*2] ~ white").decay(.08).sustain(0).gain(.6),
  n("<[0 2 4 5] [7 5 4 2]>*2".add(12)).scale("C4:major").s("z_sawtooth").gain(.2).pan(sine.slow(4))
).cpm(150/4)`,
  },
  {
    title: "Berlin Minimal",
    code: `stack(
  s("bd*4").bank("RolandTR606").gain(.9),
  s("[~ hh]*4, ~ ~ ~ [~ oh]").bank("RolandTR606").gain(.5).cut(1),
  s("click:2*16").gain(perlin.range(.05, .4)).pan(rand).hpf(2000),
  note("<a1 a1 a1 [a1 c2]>").s("sawtooth").lpf(sine.rangex(120, 700).slow(32)).decay(.2).sustain(0).gain(.75).struct("x ~ x [~ x]"),
  note("<[e4,a4] ~>/4").s("sine").fm(3).fmh(2.01).attack(.01).release(.6).gain(.3).delay(".5:.375:.7").degradeBy(.3)
).cpm(124/4)`,
  },
  {
    title: "Sitar Dusk",
    code: `stack(
  s("tabla:3 tabla:5 [tabla:1 tabla:2] tabla:4, ~ tabla:7 ~ tabla:6").gain(.6).room(.3),
  n("0 ~ [2 3] ~ 4 [3 2] ~ 0".add("<0 0 2 4>")).scale("D3:phrygian").s("sitar").gain(.55).delay(".3:.25:.4").sometimes(x => x.rev()),
  note("d2 ~ ~ ~").s("moog").release(1.5).gain(.6).lpf(400),
  note("[d4,a4]").s("pad").slow(2).attack(1).release(2).gain(.25).room(.8)
).cpm(85/4)`,
  },
  {
    title: "Neon Boulevard",
    code: `stack(
  s("bd ~ sd ~").bank("LinnDrum").gain(.9).room(.4),
  s("[hh hh] [hh oh] hh [hh hh]").bank("LinnDrum").gain(.45).cut(1),
  note("<a1 f1 c2 g1>*8").s("sawtooth").lpf(800).decay(.15).sustain(0).gain(.6).pan("0.4 0.6"),
  chord("<Am F C G>").voicing().s("supersaw").detune(.3).unison(4).spread(.6).attack(.05).release(.3).lpf(2000).gain(.35).struct("x ~ x ~ x [~ x] x ~"),
  note("<e5 [~ c5] d5 [e5 g5]>/2").s("square").lpf(1500).vib("5:.2").delay(".4:.375:.5").gain(.3)
).cpm(100/4)`,
  },
  {
    title: "Boom Bap Dust",
    code: `stack(
  s("bd ~ [~ bd] ~ [bd ~] ~ bd ~, ~ ~ sd ~ ~ ~ sd ~").bank("EmuSP12").gain(.9).swingBy(1/8, 8),
  s("hh*8").bank("EmuSP12").gain("[.5 .3 .6 .3]*2").swingBy(1/8, 8).cut(1),
  n("<0 3 5 7>".add("<0 [0 2]>")).scale("F3:minor").s("gtr").coarse(6).lpf(1800).gain(.5).delay(".2:.375:.3"),
  note("<f1 [~ f1] ab1 [c2 eb2]>").s("bass").lpf(450).gain(.9),
  s("crackle").density(.3).gain(.3)
).cpm(90/4)`,
  },
  {
    title: "Drop Zone",
    code: `stack(
  s("breaks157").fit().chop(8).gain(.8).every(4, x => x.rev()),
  s("bd ~ ~ ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~ ~ ~").bank("RolandTR909").gain(.8),
  s("~ ~ ~ ~ cp ~ ~ ~ ~ ~ ~ ~ cp ~ ~ ~").bank("RolandTR909").room(.3).gain(.6),
  note("<f1 f1 [f1 ~ ab1] [f1 eb1]>").s("sawtooth").lpf(sine.rangex(80, 600).fast(2)).lpq(4).gain(.8).shape(.4),
  note("<[f3,ab3,c4] [eb3,g3,bb3]>/2").s("supersaw").detune(.5).unison(6).attack(.3).release(1).lpf(1200).gain(.25).room(.6)
).cpm(174/4)`,
  },
  {
    title: "Moon Pool",
    code: `stack(
  s("bd*4").bank("RolandTR909").gain(.85),
  s("[~ hh]*4").bank("RolandTR909").gain(.4).cut(1),
  s("~ ~ ~ [~ sh]").bank("RolandTR727").gain(.4),
  chord("<Fm9 Ab^7 Db^7 Eb9>").voicing().s("piano").struct("~ x ~ [~ x]").lpf(1600).room(.5).gain(.45),
  note("<f1 ab1 db2 eb1>").s("bass1").lpf(400).gain(.85).struct("x ~ ~ x ~ x ~ ~"),
  note("<c5 ~ ~ eb5 ~ f5 ~ ~>/2").s("sine").fm(2).attack(.02).release(.8).delay(".5:.375:.6").gain(.3)
).cpm(120/4)`,
  },
  {
    title: "Halftime Machine",
    code: `stack(
  s("bd ~ ~ [~ bd] ~ ~ bd ~, ~ ~ ~ ~ sd ~ ~ ~").bank("RolandTR808").gain(.9),
  s("hh*8").bank("RolandTR808").gain("[.5 .3]*4").sometimes(x => x.ply(2)).cut(1),
  note("<c1 ~ [~ c1] eb1>").s("808bd").speed("<1 1 .9 1.1>").gain(.9).release(1),
  n("<0 [~ 2] 3 [~ 1]>".add("<0 -2>")).scale("C4:minor").s("bleep").delay(".4:.375:.6").gain(.35).room(.4)
).cpm(70/4)`,
  },
];
