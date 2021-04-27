import type { ILocalIdentityUIHandler } from "./interfaces/ilocalidentityuihandler";
import { localIdentityManager as localIdentity } from "./manager";
import { LocalIdentityConnector } from "./connector";
import { localizationService } from "./services/localization.service";

localizationService.init();

export type {
    // Interfaces
    ILocalIdentityUIHandler
}

export {
    // Classes
    LocalIdentityConnector,

    // Singleton instances
    localIdentity
}