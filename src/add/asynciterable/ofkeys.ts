import { AsyncIterableX } from '../../asynciterable/asynciterablex';
import { ofKeys as ofKeysStatic } from '../../asynciterable/ofkeys';

AsyncIterableX.ofKeys = ofKeysStatic;

declare module '../../asynciterable/asynciterablex' {
  namespace AsyncIterableX { export let ofKeys: typeof ofKeysStatic; }
}
