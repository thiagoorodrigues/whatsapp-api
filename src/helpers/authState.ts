import type { AuthenticationCreds, AuthenticationState } from "@whiskeysockets/baileys";
import { initAuthCreds, proto } from "@whiskeysockets/baileys";
import Whatsapp from "../models/Whatsapp";
import { sequelizeKeyRepo } from "../models/BaileysKey";
import { makeSignalKeyStore, parseKey, serializeKey } from "./baileysKeyStore";

// Creds ficam em Whatsapps.session como { creds }; as chaves de sinal ficam
// uma por linha em BaileysKeys, lidas e gravadas só quando o Baileys pede.
const authState = async (
  whatsapp: Whatsapp
): Promise<{ state: AuthenticationState; saveState: () => Promise<void> }> => {
  const stored = whatsapp.session ? (parseKey(whatsapp.session) as any) : null;
  const creds: AuthenticationCreds = stored?.creds || initAuthCreds();

  const saveState = async () => {
    try {
      await whatsapp.update({ session: serializeKey({ creds }) });
    } catch (error) {
      console.log(error);
    }
  };

  const keys = makeSignalKeyStore(sequelizeKeyRepo(whatsapp.id), {
    reviveAppStateSyncKey: value => proto.Message.AppStateSyncKeyData.create(value as any)
  });

  return {
    state: { creds, keys: keys as AuthenticationState["keys"] },
    saveState
  };
};

export default authState;
