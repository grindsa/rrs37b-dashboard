/**
 * Compatibility re-exports — prefer importing from `./fsapi`.
 */
export {
  FsapiError,
  FsapiPowerError,
  type FsapiTarget,
  type FsapiPowerTarget,
  getFsapiPowerOn,
  setFsapiPowerOn,
} from "./fsapi";
