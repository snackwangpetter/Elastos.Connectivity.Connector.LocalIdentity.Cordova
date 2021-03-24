import { storage } from "@elastosfoundation/elastos-connectivity-sdk-cordova";

class StorageService {
  constructor() {}

  public setProfile(value: any) {
    return storage.set("profile", JSON.stringify(value)).then((data) => {
    });
  }

  public getProfile(): Promise<any> {
    return storage.get("profile", "{}").then((data) => {
      return JSON.parse(data);
    });
  }
}

export const storageService = new StorageService();

