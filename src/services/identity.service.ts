import { DID, storage, connectivity } from '@elastosfoundation/elastos-connectivity-sdk-cordova';
import { DIDPublicationStatus } from '../model/didpublicationstatus.model';
import { HiveCreationStatus } from '../model/hivecreationstatus.model';
import { persistenceService } from './persistence.service';
import { hiveService } from './hive.service';

declare let didManager: DIDPlugin.DIDManager;
declare let hiveManager: HivePlugin.HiveManager;

const assistAPIEndpoint = "https://assist.trinity-tech.io/v2";  //"https://assist-restapi.tuum.tech/v2" // DID 2.0
//const assistAPIEndpoint = "https://wogbjv3ci3.execute-api.us-east-1.amazonaws.com/prod/v1"; // DID 1.0
const assistAPIKey = "IdSFtQosmCwCB9NOLltkZrFy5VqtQn8QbxBKQoHPw7zp3w0hDOyOYjgL53DO3MDH";

const availableProviders = [
    "https://api.elastos.io/eid", // elastos.io EID
    "https://api.trinity-tech.io/eid" // Trinity tech EID
]

type AssistBaseResponse = {
    meta: {
        code: number,
        message: string,
        description?: string
    }
}

type AssistCreateTxResponse = AssistBaseResponse & {
    data: {
        confirmation_id: string,
        service_count: number,
        duplicate: boolean
    }
}

enum AssistTransactionStatus {
    PENDING = "Pending",
    PROCESSING = "Processing",
    COMPLETED = "Completed",
    QUARANTINED = "Quarantined",
    ERROR = "Error"
}

type AssistTransactionStatusResponse = AssistBaseResponse & {
    data: {
        id: string, // Confirmation ID as requested
        did: string, // DID, without did:elastos prefix
        requestFrom: string, // App package id of the requester
        didRequest: any, // Unhandled for now
        status: AssistTransactionStatus,
        memo: string,
        extraInfo: any, // Unhandled for now
        blockchainTxId: string,
        blockchainTx: any,
        created: string, // Creation date, in no clear format for now
        modified: string // Modification (?) date, in no clear format for now
    }
}

class IdentityService {
    private didAccess: DID.DIDAccess;

    constructor() {
        this.didAccess = new DID.DIDAccess();
    }

    /**
     * Tells if the identity is fully ready to use (so we can proceed to real intent requests) or if it needs
     * to be setup first.
     */
    public async identityIsFullyReadyToUse(): Promise<boolean> {
        let persistentInfo = persistenceService.getPersistentInfo();

        if (persistentInfo.did.publicationStatus == DIDPublicationStatus.PUBLISHED_AND_CONFIRMED &&
            persistentInfo.hive.creationStatus == HiveCreationStatus.VAULT_CREATED_AND_VERIFIED) {
            return true;
        }
        else {
            return false;
        }
    }

    /**
     * Tells if the DID is published and confirmed. Hive doesn't need to be ready yet.
     */
    public async identityIsPublished(): Promise<boolean> {
        let persistentInfo = persistenceService.getPersistentInfo();

        return (persistentInfo.did.publicationStatus == DIDPublicationStatus.PUBLISHED_AND_CONFIRMED);
    }

    public async createLocalIdentity() {
        // First, auto detect the best DID resolver (fastest, accessible)
        await this.autoDetectTheBestProvider();

        let persistentInfo = persistenceService.getPersistentInfo();
        let createdDIDInfo = await this.didAccess.fastCreateDID("ENGLISH");

        if (!createdDIDInfo) {
            console.error("Null DID returned!");
            return;
        }

        console.log("DID has been created:", createdDIDInfo);

        // Save the created DID info. We don't bother user with manual passwords or mnemonics, as this is a "temporary"
        // identity only.
        persistentInfo.did.didString = createdDIDInfo.did.getDIDString();
        persistentInfo.did.storeId = createdDIDInfo.didStore.getId();
        persistentInfo.did.storePassword = createdDIDInfo.storePassword;
        persistentInfo.did.publicationStatus = DIDPublicationStatus.PUBLICATION_NOT_REQUESTED;

        await persistenceService.savePersistentInfo(persistentInfo);
    }

    public async getLocalDID(): Promise<DIDPlugin.DID> {
        let persistentInfo = persistenceService.getPersistentInfo();
        if (!persistentInfo.did.storeId)
            return null;

        let didStore = await DID.DIDHelper.openDidStore(persistentInfo.did.storeId);
        return await DID.DIDHelper.loadDID(didStore, persistentInfo.did.didString);
    }

    public async getDIDMnemonic(): Promise<string> {
        let persistentInfo = persistenceService.getPersistentInfo();
        let didStore = await DID.DIDHelper.openDidStore(persistentInfo.did.storeId);
        return await new Promise((resolve) => {
            didStore.exportMnemonic(persistentInfo.did.storePassword, (mnemonic) => {
                resolve(mnemonic);
            }, (e) => resolve(""));
        });
    }

    /**
     * Queries the DID sidechain to check if the given DID is published or not.
     */
    public async getIdentityOnChain(didString: string): Promise<DIDPlugin.DIDDocument> {
        return new Promise((resolve, reject) => {
            didManager.resolveDidDocument(didString, true, (document) => {
                resolve(document);
            }, (err) => {
                reject(err);
            });
        });
    }

    /**
     * Publish the DID using assist api
     */
    public async publishIdentity(): Promise<void> {
        console.log("Starting the DID publication process");

        return new Promise(async (resolve, reject) => {
            try {
                let persistentInfo = persistenceService.getPersistentInfo();

                let didStore = await this.openDidStore(persistentInfo.did.storeId, async (payload: string, memo: string) => {
                    // Callback called by the DID SDK when trying to publish a DID.
                    console.log("Create ID transaction callback is being called", payload, memo);
                    let payloadAsJson = JSON.parse(payload);
                    try {
                        await this.publishDIDOnAssist(persistentInfo.did.didString, payloadAsJson, memo);
                        resolve();
                    }
                    catch (err) {
                        reject(err);
                    }
                });

                let localDIDDocument = await this.loadLocalDIDDocument(didStore, persistentInfo.did.didString);

                // Hive support: we directly automatically select a random hive node and define it as a service in the
                // DID document, before we publish at first. Because we don't want to publish the DID 2 times.
                await this.addRandomHiveToDIDDocument(localDIDDocument, persistentInfo.did.storePassword);

                // Start the publication flow
                localDIDDocument.publish(persistentInfo.did.storePassword, () => { }, (err) => {
                    // Local "publish" process errored
                    console.log("Local DID Document publish(): error", err);
                    reject(err);
                });
            }
            catch (e) {
                reject(e);
            }
        });
    }

    private addRandomHiveToDIDDocument(localDIDDocument: DIDPlugin.DIDDocument, storePassword: string): Promise<void> {
        return new Promise(async (resolve, reject) => {
            let randomHideNodeAddress = hiveService.getRandomQuickStartHiveNodeAddress();
            if (randomHideNodeAddress) {
                let service = didManager.ServiceBuilder.createService('#hivevault', 'HiveVault', randomHideNodeAddress);
                await this.removeHiveVaultServiceFromDIDDocument(localDIDDocument, storePassword);
                localDIDDocument.addService(service, storePassword, async () => {
                    // Save this hive address to persistence for later use
                    let persistentInfo = persistenceService.getPersistentInfo();
                    persistentInfo.hive.vaultProviderAddress = randomHideNodeAddress;
                    await persistenceService.savePersistentInfo(persistentInfo);

                    resolve();
                }, (err) => {
                    reject(err);
                });
            }
            else {
                reject("Hive node address cannot be null");
            }
        });
    }

    private removeHiveVaultServiceFromDIDDocument(localDIDDocument: DIDPlugin.DIDDocument, storePassword: string): Promise<void> {
        return new Promise((resolve) => {
            localDIDDocument.removeService("#hivevault", storePassword, () => {
                resolve();
            }, (err) => {
                // Resolve normally in case of error, as this may be a "service does not exist" error which is fine.
                resolve();
            });
        });
    }

    // DOC FOR ASSIST API: https://github.com/tuum-tech/assist-restapi-backend#verify
    private publishDIDOnAssist(didString: string, payloadObject: any, memo: string) {
        return new Promise<void>(async (resolve, reject) => {
            console.log("Requesting identity publication to Assist");

            let assistAPIKey = "IdSFtQosmCwCB9NOLltkZrFy5VqtQn8QbxBKQoHPw7zp3w0hDOyOYjgL53DO3MDH";

            let requestBody = {
                "did": didString,
                "memo": memo || "",
                "requestFrom": connectivity.getApplicationDID() + "-cordovasdk",
                "didRequest": payloadObject
            };

            console.log("Assist API request body:", requestBody);

            let fetchResponse = await fetch(assistAPIEndpoint + "/didtx/create", {
                method: 'POST',
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": assistAPIKey
                },
                body: JSON.stringify(requestBody)
            });

            try {
                let response: AssistCreateTxResponse = await fetchResponse.json();
                console.log("Assist successful response:", response);
                if (response && response.meta) {
                    if (response.meta.code == 200 && response.data.confirmation_id) {
                        console.log("All good, DID has been submitted. Now waiting.");

                        let persistentInfo = persistenceService.getPersistentInfo();
                        persistentInfo.did.publicationStatus = DIDPublicationStatus.AWAITING_PUBLICATION_CONFIRMATION;
                        persistentInfo.did.assistPublicationID = response.data.confirmation_id;
                        await persistenceService.savePersistentInfo(persistentInfo);

                        resolve();
                    }
                    else {
                        console.error("Assist API returned an error:", response.meta);
                        reject(response.meta.description);
                    }
                } else {
                    let error = "Successful response received from the assist API, but response can't be understood";
                    reject(error);
                }
            }
            catch (err) {
                console.log("Assist api call error:", err);
                reject(err);
            }
        });
    }

    /**
     * Checks the publication status on the assist API, for a previously saved ID.
     */
    public async checkPublicationStatusAndUpdate(): Promise<void> {
        return new Promise(async (resolve, reject) => {
            let persistentInfo = persistenceService.getPersistentInfo();

            console.log("Requesting identity publication status to Assist for confirmation ID " + persistentInfo.did.assistPublicationID);

            let fetchResponse = await fetch(assistAPIEndpoint + "/didtx/confirmation_id/" + persistentInfo.did.assistPublicationID, {
                method: 'GET',
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": assistAPIKey
                }
            });

            try {
                let response: AssistTransactionStatusResponse = await fetchResponse.json();
                console.log("Assist successful response:", response);
                if (response && response.meta && response.meta.code == 200 && response.data.status) {
                    console.log("All good, We got a clear status from the assist api:", response.data.status);

                    if (response.data.status == AssistTransactionStatus.PENDING || response.data.status == AssistTransactionStatus.PROCESSING) {
                        // Transaction is still pending, we do nothing, just wait and retry later.
                        console.log("Publication is still pending / processing / not confirmed.");
                    }
                    else if (response.data.status == AssistTransactionStatus.QUARANTINED) {
                        // Blocking issue. This publication was quarantined, there is "something wrong somewhere".
                        // So to make things more reliable, we just delete everything and restart the process
                        // from scratch.
                        console.log("Publication request was quarantined! Deleting the identity and trying again.");
                        await this.resetOnGoingProcess();
                    }
                    else if (response.data.status == AssistTransactionStatus.COMPLETED) {
                        // Publication is now on chain, so we can change our local status.
                        let persistentInfo = persistenceService.getPersistentInfo();
                        persistentInfo.did.publicationStatus = DIDPublicationStatus.PUBLISHED_AND_CONFIRMED;
                        await persistenceService.savePersistentInfo(persistentInfo);
                    }
                    else {
                        console.error("Unhandled transaction status received from assist:", response.data.status);
                    }

                    resolve();
                } else {
                    let error = "Successful response received from the assist API, but response can't be understood";
                    reject(error);
                }
            }
            catch (err) {
                console.log("Assist api call error:", err);
                reject(err);
            }
        });
    }

    /**
     * Resets the whole process as if we were at the beginning.
     */
    public async resetOnGoingProcess() {
        try {
            // Reset hive authentication
            let vault = await hiveService.getUserVault();
            vault.revokeAccessToken();
        }
        catch (e) {
            // Failing? We try to not mind, we continue because we cannot recover a from a recovery...
        }

        // Delete app instance DID information
        storage.set("dappsdk_appinstancedidstoreid", null);
        storage.set("dappsdk_appinstancedidstring", null);
        storage.set("dappsdk_appinstancedidstorepassword", null);

        // Clear identity creation flow status
        await persistenceService.reset();
    }

    private openDidStore(storeId: string, createIdTransactionCallback: DIDPlugin.OnCreateIdTransaction): Promise<DIDPlugin.DIDStore> {
        return new Promise((resolve) => {
            didManager.initDidStore(storeId, createIdTransactionCallback, (didstore) => {
                resolve(didstore);
            }, (err) => {
                resolve(null);
            });
        });
    }

    private loadLocalDIDDocument(didStore: DIDPlugin.DIDStore, didString: string): Promise<DIDPlugin.DIDDocument> {
        return new Promise((resolve) => {
            didStore.loadDidDocument(didString, (didDocument) => {
                resolve(didDocument);
            }, (err) => {
                resolve(null);
            });
        });
    }

    /**
     * Generates a semi-"fake" presentation that contains credentials for the required claims.
     * As this is a local identity, we have to emulate everything that's missing with placeholders.
     */
    public async generatePresentationForClaims(claims: any): Promise<DIDPlugin.VerifiablePresentation> {
        let persistenceInfo = persistenceService.getPersistentInfo();

        // Take all the claims requested in the original intent and return credentials for each of them, with fake data.
        let credentials: DIDPlugin.VerifiableCredential[] = [];

        for (let claimName of Object.keys(claims)) {
            let credential = await this.createCredential(claimName, persistenceInfo.did.storePassword);
            console.log("Created temporary credential for claim:", claimName, credential);

            if (credential)
                credentials.push(credential);
        }

        return this.createCredaccessPresentation(credentials);
    }

    private async createCredential(claimName: string, storePassword: string): Promise<DIDPlugin.VerifiableCredential> {
        const did = await identityService.getLocalDID();
        const localProfile = await storage.getJSON('profile', {});
        console.log('Local profile', localProfile);

        const localName = localProfile.name || null;
        const localEmail = localProfile.email || null;

        // Handle a few standard claims nicely. Others default to a default value.
        let properties: any = {};
        switch (claimName) {
            case "name":
                properties.name = localName ? localName : "Anonymous user";
                break;
            case "email":
                properties.email = localEmail ? localEmail : "unknown@email.com";
            default:
                // Unhandled properties. Credential properties cannot be empty, so we fill that with dummy data.
                properties[claimName] = "Information not provided";
        }

        return new Promise((resolve) => {
            did.issueCredential(did.getDIDString(), "#" + claimName, ["TemporaryCredential"], 365, properties, storePassword, (cred) => {
                resolve(cred);
            }, (err) => {
                console.error(err);
                resolve(null);
            });
        });
    }

    public createCredaccessPresentation(credentials: DIDPlugin.VerifiableCredential[]): Promise<DIDPlugin.VerifiablePresentation> {
        return new Promise(async (resolve) => {
            let persistentInfo = persistenceService.getPersistentInfo();
            let didStore = await DID.DIDHelper.openDidStore(persistentInfo.did.storeId);
            let did = await DID.DIDHelper.loadDID(didStore, persistentInfo.did.didString);

            // TODO: embed the "name" credential when we have this configuration available on the UI.
            did.createVerifiablePresentation(credentials, "none", "none", persistentInfo.did.storePassword, (presentation) => {
                resolve(presentation);
            }, (err) => {
                console.error("Error while creating the credaccess presentation:", err);
                resolve(null);
            });
        });
    }

    /**
     * Generates a appid credential for hive authentication, silently
     */
    public async generateApplicationIDCredential(appinstancedid: string, mainNativeApplicationDID: string): Promise<DIDPlugin.VerifiableCredential> {
        return new Promise(async (resolve) => {
            let persistentInfo = persistenceService.getPersistentInfo();

            console.log("Generating appid credential");
            console.log("Local identity DID:", persistentInfo.did.didString);

            let properties = {
                appInstanceDid: appinstancedid,
                appDid: mainNativeApplicationDID,
            };

            console.log("Properties:", properties);

            let userDID = await this.getLocalDID();
            if (userDID) {
                userDID.issueCredential(
                    appinstancedid,
                    "#app-id-credential",
                    ['AppIdCredential'],
                    30, // one month - after that, we'll need to generate this credential again.
                    properties,
                    persistentInfo.did.storePassword,
                    async (issuedCredential) => {
                        resolve(issuedCredential);
                    }, async (err) => {
                        console.error("Failed to issue the app id credential...", err);
                        resolve(null);
                    }
                );
            }
            else {
                console.log("Sending empty appidcredissue intent response as no identity was found.");
                resolve(null);
            }
        });
    }

    /**
     * Tries to find the best elastos API provider for the current device location. When found, this provider
     * is selected and used as currently active provider.
     */
    public async autoDetectTheBestProvider(): Promise<void> {
        console.log("Trying to auto detect the best elastos api provider");
        let bestProvider = await this.findTheBestProvider();
        console.log("Best provider found:", bestProvider);

        // Immediatelly let plugins know about this selected provider, because DID sessions
        // need to set the right resolver urls even if no user is signed in.
        await this.setResolverUrl();
    }

    /**
     * Tries to find the best provider and returns it.
     */
    private _bestProviderEndpoint: string; // EID resolve endpoint of the best provider found
    private async findTheBestProvider(): Promise<string> {
        // To know the best provider, we try to call an api on all of them and then select the fastest
        // one to answer.
        this._bestProviderEndpoint = null;
        let testPromises: Promise<void>[] = availableProviders.map(p => this.callTestAPIOnProvider(p));
        await Promise.race(testPromises);
        return this._bestProviderEndpoint;
    }

    /**
     * Call a test API on a provider to check its speed in findTheBestProvider().
     * - All errors are catched and not forwarded because we don't want Promise.race() to throw, we
     * want it to resolve the first successful call to answer.
     * - API calls that return errors are resolved with a timeout, to make sure they are considered as
     * "slow" but on the other hand that they resolve one day (we can't stack unresolved promises forever).
     */
    private callTestAPIOnProvider(providerEndpoint: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-misused-promises, no-async-promise-executor
        return new Promise(async (resolve) => {
            let testApiUrl = providerEndpoint;

            const param = {
                method: 'getblockcount',
            };

            try {
                let data = await fetch(providerEndpoint, {
                    method: 'POST',
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(param)
                });

                console.log("Provider " + providerEndpoint + " just answered the test api call with value", data);
                // Set the provider as best provider if no one did that yet. We are the fastest api call to answer.
                if (!this._bestProviderEndpoint)
                    this._bestProviderEndpoint = providerEndpoint;
                resolve();
            } catch (e) {
                console.warn("Auto detect api call to " + testApiUrl + " failed with error:", e);
                // Resolve later, to let othe providers answer faster
                setTimeout(() => {
                    resolve();
                }, 30000); // 30s
            }
        });
    }

    private async setResolverUrl(): Promise<void> {
        let didResolverUrl = this._bestProviderEndpoint;

        console.log('Changing DID plugin resolver in DID and Hive plugins to :', didResolverUrl);
        // DID Plugin
        await new Promise<void>((resolve, reject) => {
            didManager.setResolverUrl(didResolverUrl, () => {
                resolve();
            }, (err) => {
                console.error('didplugin setResolverUrl error:', err);
                reject(err);
            });
        });

        // Hive plugin
        await hiveManager.setDIDResolverUrl(didResolverUrl);
    }

    /**
     * Save in global preferences that the user has chosen to use the external identity wallet app (elastOS)
     * to handle special intents. This information is used for example by the native title bar to know if a
     * "manage account" icon should be displayed or not.
     */
    /*public async saveUsingExternalIdentityWalletPreference(): Promise<void> {
        return new Promise((resolve) => {
            appManager.setPreference("internalidentity.inuse", false, () => {
                resolve();
            }, (err) => {
                // Maybe no permission to call setPreference if developping this app inside elastOS. that's ok,
                // just forget it and resolve.
                console.warn(err);
                resolve();
            });
        });
    }*/

    /**
     * Save in global preferences that the user has chosen to use the built-in identity wallet app (this app)
     * to handle special intents. This information is used for example by the native title bar to know if a
     * "manage account" icon should be displayed or not.
     */
    /*public async saveUsingBuiltInIdentityWalletPreference(): Promise<void> {
        return new Promise((resolve) => {
            appManager.setPreference("internalidentity.inuse", true, () => {
                resolve();
            }, (err) => {
                // Maybe no permission to call setPreference if developping this app inside elastOS. that's ok,
                // just forget it and resolve.
                console.warn(err);
                resolve();
            });
        });
    }*/

    /**
     * Tells if we are using the built in identity.
     */
    /*public async isUsingBuiltInIdentityWalletPreference(): Promise<boolean> {
        return new Promise((resolve) => {
            appManager.getPreference("internalidentity.inuse", (inUse) => {
                resolve(inUse);
            }, (err) => {
                // Preference not found, this means we never created or used a built in identity.
                resolve(false);
            });
        });
    }*/
}

export const identityService = new IdentityService();