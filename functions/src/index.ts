import * as admin from "firebase-admin"
import * as functions from "firebase-functions"
import {pipe, split, shuffle, take, join} from "lodash/fp"
import {DateTime} from "luxon"

admin.initializeApp()

const auth = admin.auth()
const firestore = admin.firestore()
const {onCall} = functions.region("europe-west1").https
const codeCharRange = "ABCDEFGHJKMNPQRSTUVWXYZ123456789"

function generatePairingCode() {
  try {
    const code: string = pipe([split(""), shuffle, take(5), join("")])(codeCharRange)
    const screenRef = firestore.collection("screens").doc(code)
    const {id} = firestore.collection("screens").doc()
    return firestore.runTransaction(async tx => {
      const screen = await tx.get(screenRef)
      if (screen.exists) throw new Error("code-already-exists")
      tx.set(screenRef, {
        id,
        code,
        userId: null,
        exp: DateTime.local()
          .plus({hour: 1})
          .toJSDate(),
      })

      return {ok: true, id, code}
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
    const screenRef = firestore.collection("screens").doc(code)
    const screenId = await firestore.runTransaction(async tx => {
      const screen = await tx.get(screenRef)
      if (!screen.exists) throw new Error("code-not-found")
      const data = screen.data()
      if (!data) throw new Error("code-invalid")
      if (data.userId) throw new Error("code-already-used")
      tx.set(screenRef, {userId}, {merge: true})
      return data.id
    })

    await firestore.collection(`users/${userId}/screens`).add({id: screenId, layoutId: null})

    // Clean expired codes asynchronously
    firestore
      .collection("screens")
      .where("exp", "<", new Date())
      .get()
      .then(snapshot => snapshot.forEach(doc => doc.ref.delete()))

    return {ok: true, screenId}
  } catch (err) {
    return {ok: false, message: err.message}
  }
})
