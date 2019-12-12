import * as admin from "firebase-admin"
import * as functions from "firebase-functions"
import {pipe, split, shuffle, take, join} from "lodash/fp"
import {DateTime} from "luxon"

admin.initializeApp()

const auth = admin.auth()
const firestore = admin.firestore()
const {onCall} = functions.region("europe-west1").https
const codeCharRange = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

function generatePairingCode() {
  try {
    const code: string = pipe([split(""), shuffle, take(5), join("")])(codeCharRange)
    const codeDocRef = firestore.collection("pairingCodes").doc(code)
    return firestore.runTransaction(async t => {
      const codeDoc = await t.get(codeDocRef)
      if (codeDoc.exists) throw new Error("code-already-exists")
      t.set(codeDocRef, {
        code,
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

export const linkScreenToUser = onCall(async ({idToken, code}) => {
  try {
    const {uid: userId} = await auth.verifyIdToken(idToken)
    const codeDocRef = firestore.collection("pairingCodes").doc(code)
    const screenId = await firestore.runTransaction(async t => {
      const codeDoc = await t.get(codeDocRef)
      if (!codeDoc.exists) throw new Error("code-not-found")
      const data = codeDoc.data()
      if (!data) throw new Error("code-invalid")

      return firestore
        .collection(`users/${userId}/screens`)
        .add({code})
        .then(({id}) => id)
    })

    // Clean expired codes
    firestore
      .collection("pairingCodes")
      .where("exp", "<", new Date())
      .get()
      .then(snapshot => snapshot.forEach(doc => doc.ref.delete()))

    await codeDocRef.delete()

    return {ok: true, screenId}
  } catch (err) {
    return {ok: false, message: err.message}
  }
})
