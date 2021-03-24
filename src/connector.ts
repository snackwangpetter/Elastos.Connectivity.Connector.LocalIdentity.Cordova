import type { Connectors, PayQuery, TransactionResult } from "@elastosfoundation/elastos-connectivity-sdk-cordova";
import { identityService } from "./services/identity.service";
import type { GetCredentialsQuery } from "@elastosfoundation/elastos-connectivity-sdk-cordova";
import { _, localization } from "@elastosfoundation/elastos-connectivity-sdk-cordova";
import { localIdentityUIHandler } from "./defaultui/localidentityuihandler";

export class LocalIdentityConnector implements Connectors.IConnector {
    public name: string = "local-identity";

    constructor() {
    }

    async getDisplayName(): Promise<string> {
        return localization.translateInstant("local-identity-name");
    }

    /**
     * DID API
     */

    async getCredentials(query: GetCredentialsQuery): Promise<DIDPlugin.VerifiablePresentation> {
        if (!await identityService.identityIsFullyReadyToUse()) {
            // No local identity yet: we have to create one first
            console.log("Local identity is not ready to use, showing identity creation screen");
            await localIdentityUIHandler.showCreateIdentity();
            console.log("Local identity - getCredentials() - after showCreateIdentity()");
            return null; // TODO: for now, after the initial creation, we don't proceed to the initial request. This is to be done
        }
        else {
            let credential = await localIdentityUIHandler.showRequestGetCredentials(query);
            return credential;
        }
    }

    async generateAppIdCredential(appInstanceDID: string, appDID: string): Promise<DIDPlugin.VerifiableCredential> {
        if (!await identityService.identityIsPublished()) {
            // No local identity yet: we have to create one first
            console.log("Local identity is not ready to use, showing identity creation screen");
            await localIdentityUIHandler.showCreateIdentity();
            return null; // TODO: for now, after the initial creation, we don't proceed to the initial request. This is to be done
        }
        else {
            let credential = await localIdentityUIHandler.showRequestIssueAppIDCredential(appInstanceDID, appDID);
            return credential;
        }
    }

    /**
     * Wallet API
     */

    async pay(query: PayQuery): Promise<TransactionResult> {
        throw new Error("Method not implemented.");
    }

    async voteForDPoS() {
        throw new Error("Method not implemented.");
    }

    async voteForCRCouncil() {
        throw new Error("Method not implemented.");
    }

    async voteForCRProposal() {
        throw new Error("Method not implemented.");
    }

    async sendSmartContractTransaction(payload: any): Promise<string> {
        throw new Error("Method not implemented.");
    }
}