import type { ILocalIdentityUIHandler } from "../interfaces/ilocalidentityuihandler";
import ModalContainer from "../defaultui/components/ModalContainer.svelte";
import Root from './pages/Root.svelte';
import { ViewType } from "./viewtype";
import { navService } from "./nav.service";
import type { IdentitySetupNavParams } from "./navparams";
import type { GetCredentialsQuery } from "@elastosfoundation/elastos-connectivity-sdk-cordova";
import { identityService } from "../services/identity.service";

class LocalIdentityUIHandler implements ILocalIdentityUIHandler {
    private localIdentityModalShown = false;
    private genericModalContainer = new ModalContainer({
        target: document.body
    });

    constructor() {
    }

    private async showRootComponentInModal(onPopupClosed?: ()=>void): Promise<void> {
        return new Promise((resolve)=>{
            if (!this.localIdentityModalShown) {
                this.genericModalContainer.show(Root, {
                }, {
                    onOpen: () => {
                        this.localIdentityModalShown = true
                        resolve();
                    },
                    onClosed: ()=>{
                        this.localIdentityModalShown = false;
                        if (onPopupClosed)
                            onPopupClosed();
                    }
                });
            }
            else {
                // Nothing to do
                resolve();
            }
        });
    }

    /**
     * Show the local identity creation popup / flow / steps
     */
    async showCreateIdentity(): Promise<void> {
        return new Promise(async (resolve)=>{
            //console.log("Local identity: showCreateIdentity()");
            await this.showRootComponentInModal();
            //console.log("Setting view type to IdentitySetup");
            navService.navigateTo(ViewType.IdentitySetup, {
                onIdentityCreationCompleted:() => {
                    resolve();
                }
            } as IdentitySetupNavParams);

            // NOTE: if user cancels, we never fulfill this promise for now.
        });
    }

    showRequestGetCredentials(query: GetCredentialsQuery): Promise<DIDPlugin.VerifiablePresentation> {
        // NOTE: No UI shown, direct response
        return identityService.generatePresentationForClaims(query.claims);
    }

    showRequestIssueAppIDCredential(appInstanceDID: string, appDID: string): Promise<DIDPlugin.VerifiableCredential> {
        // NOTE: No UI shown, direct response
        return identityService.generateApplicationIDCredential(appInstanceDID, appDID);
    }

    showManageIdentity(): Promise<void> {
        return new Promise(async (resolve)=>{
            await this.showRootComponentInModal();
            navService.navigateTo(ViewType.ManageIdentity);
            // navService.navigateTo(ViewType.IdentitySetup);
            // NOTE: if user cancels, we never fulfill this promise for now.
        });
    }
}

export const localIdentityUIHandler = new LocalIdentityUIHandler();