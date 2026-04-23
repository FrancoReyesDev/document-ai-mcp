import { Firestore } from "@google-cloud/firestore";

/**
 * Adapter para oidc-provider que persiste todos sus modelos en Firestore.
 * Colecciones: oidc_{modelName} (e.g., oidc_Session, oidc_AccessToken).
 *
 * TTL se gestiona vía el campo `expiresAt` + Firestore TTL policies
 * (configurar con `gcloud firestore fields ttls update`).
 *
 * Ref: https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#adapter
 */

type AdapterPayload = {
  [key: string]: unknown;
  grantId?: string;
  userCode?: string;
  uid?: string;
  consumed?: number;
};

export function makeFirestoreAdapter(db: Firestore) {
  return class FirestoreAdapter {
    name: string;
    collection: FirebaseFirestore.CollectionReference;

    constructor(name: string) {
      this.name = name;
      this.collection = db.collection(`oidc_${name}`);
    }

    async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
      // expiresIn viene undefined para modelos permanentes (Client via DCR).
      // Solo seteamos expiresAt si hay TTL real.
      const doc: Record<string, unknown> = { ...payload };
      if (typeof expiresIn === "number" && expiresIn > 0) {
        doc.expiresAt = new Date(Date.now() + expiresIn * 1000);
      }
      await this.collection.doc(id).set(doc, { merge: false });
    }

    async find(id: string): Promise<AdapterPayload | undefined> {
      const doc = await this.collection.doc(id).get();
      if (!doc.exists) return undefined;
      const data = doc.data() as (AdapterPayload & { expiresAt?: FirebaseFirestore.Timestamp }) | undefined;
      if (!data) return undefined;
      if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) return undefined;
      const { expiresAt: _, ...payload } = data;
      return payload;
    }

    async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
      const snapshot = await this.collection.where("userCode", "==", userCode).limit(1).get();
      if (snapshot.empty) return undefined;
      return snapshot.docs[0].data() as AdapterPayload;
    }

    async findByUid(uid: string): Promise<AdapterPayload | undefined> {
      const snapshot = await this.collection.where("uid", "==", uid).limit(1).get();
      if (snapshot.empty) return undefined;
      return snapshot.docs[0].data() as AdapterPayload;
    }

    async consume(id: string): Promise<void> {
      await this.collection.doc(id).update({ consumed: Math.floor(Date.now() / 1000) });
    }

    async destroy(id: string): Promise<void> {
      await this.collection.doc(id).delete();
    }

    async revokeByGrantId(grantId: string): Promise<void> {
      const snapshot = await this.collection.where("grantId", "==", grantId).get();
      const batch = db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      if (!snapshot.empty) await batch.commit();
    }
  };
}
