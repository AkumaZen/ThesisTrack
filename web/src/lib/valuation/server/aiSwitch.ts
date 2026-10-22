import { env } from '$env/dynamic/private';

/** Message shown wherever an AI feature is refused because the kill switch is on. */
export const AI_OFF_MESSAGE = 'AI features are turned off';

/** Kill switch for every AI call in the app. On unless AI_FEATURES=off is set. */
export const aiEnabled = () => env.AI_FEATURES !== 'off';
