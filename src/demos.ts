import { voice } from './score';
import { makeSong, Song } from './song';

export const ODE_RIGHT =
  'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:0.5 D4:2 ' +
  'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:1.5 C4:0.5 C4:2';
export const ODE_LEFT = 'C3:4 G3:4 C3:4 G3:4 C3:4 G3:4 C3:4 G3:2 C3:2';

export const TWINKLE_RIGHT =
  'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2 ' +
  'G4 G4 F4 F4 E4 E4 D4:2 G4 G4 F4 F4 E4 E4 D4:2 ' +
  'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2';
export const TWINKLE_LEFT =
  'C3:4 F3:2 C3:2 F3:2 C3:2 G3:2 C3:2 C3:2 F3:2 C3:2 G3:2 C3:2 F3:2 C3:2 G3:2 ' +
  'C3:4 F3:2 C3:2 F3:2 C3:2 G3:2 C3:2';

export const demoSongs: Song[] = [
  makeSong('demo-twinkle', 'Twinkle Twinkle Little Star', [...voice(TWINKLE_RIGHT, 'R', 90), ...voice(TWINKLE_LEFT, 'L', 90)], true),
  makeSong('demo-ode', 'Ode to Joy (Beethoven)', [...voice(ODE_RIGHT, 'R', 100), ...voice(ODE_LEFT, 'L', 100)], true),
];
