import { editProfile } from '../../app/src/main/assets/profiles.js';
declare const screen: Parameters<typeof editProfile>[0];
screen.nav.leave(() => screen.nav.show());
// @ts-expect-error The profile editor must reject unknown navigation methods.
screen.nav.mayLeave();
