import { en } from '../assets/localidentity/languages/en';
import { fr } from '../assets/localidentity/languages/fr';
import { zh } from '../assets/localidentity/languages/zh';
import { format, getMessageFormatter, dictionary, locale } from "svelte-i18n";
import { localization } from '@elastosfoundation/elastos-connectivity-sdk-cordova';

class LocalizationService {
    private activeLanguage: string;
    private baseLanguages = {
        en: en,
        fr: fr,
        zh: zh
    }
    private currentLanguages = this.baseLanguages;

    constructor() {
    }

    public init() {
        // Catch language change events from the connectivity SDK.
        localization.activeLanguage.subscribe((lang)=>{
            this.setLanguage(lang);
        })

        locale.subscribe((lang)=>{
            this.activeLanguage = lang;
        });

        dictionary.set(this.currentLanguages);
        this.setLanguage('en');
    }

    /**
     * Sets the active language for all UI items.
     */
    private setLanguage(lang: string) {
        console.log("Setting Local Identity Connector language to: ", lang);
        locale.set(lang);
    }

    public translateInstant(key: string): string {
        return getMessageFormatter(key).format() as string;
    }
}

export const localizationService = new LocalizationService();
