import * as admin from "firebase-admin"
import * as functions from "firebase-functions"
import {DateTime} from "luxon"
import * as uuid from "uuid/v4"
import {pipe, split, shuffle, take, join} from "lodash/fp"

admin.initializeApp()

const auth = admin.auth()
const firestore = admin.firestore()
const {onCall} = functions.region("europe-west1").https
const codeCharRange = "ABCDEFGHJKMNPQRSTUVWXYZ123456789"

function generatePairingCode() {
  try {
    const code: string = pipe([split(""), shuffle, take(5), join("")])(codeCharRange)
    const screenRef = firestore.collection("pairings").doc(code)
    const {id} = firestore.collection("pairings").doc()
    return firestore.runTransaction(async tx => {
      const screen = await tx.get(screenRef)
      if (screen.exists) throw new Error("code-already-exists")
      tx.set(screenRef, {
        id,
        code,
        userId: null,
        screenId: null,
        exp: DateTime.local()
          .plus({hour: 1})
          .toJSDate(),
      })

      return {ok: true, code}
    })
  } catch (err) {
    return {ok: false, message: err.message}
  }
}

export const requestPairingCode = onCall(async () => {
  let res = {ok: false}

  for (let retries = 5; !res.ok && retries > 0; retries--) {
    res = await generatePairingCode()
  }

  return res
})

export const linkScreenToUser = onCall(async ({idToken, code, name}) => {
  try {
    const {uid: userId} = await auth.verifyIdToken(idToken)
    const {id: screenId} = firestore.collection(`users/${userId}/screens`).doc()
    const pairingRef = firestore.collection("pairings").doc(code)
    const pairingId = await firestore.runTransaction(async tx => {
      const pairing = await tx.get(pairingRef)
      if (!pairing.exists) throw new Error("code-not-found")
      const data = pairing.data()
      if (!data) throw new Error("code-invalid")
      if (data.userId) throw new Error("code-already-used")
      tx.set(pairingRef, {userId, screenId}, {merge: true})
      return data.id
    })

    await firestore
      .doc(`users/${userId}/screens/${screenId}`)
      .set({id: screenId, name, pairingId, layout: {id: uuid(), type: "leaf", data: null}})

    // Clean expired codes asynchronously
    firestore
      .collection("pairings")
      .where("exp", "<", new Date())
      .get()
      .then(snap => snap.forEach(doc => doc.ref.delete()))

    return {ok: true}
  } catch (err) {
    return {ok: false, message: err.message}
  }
})
