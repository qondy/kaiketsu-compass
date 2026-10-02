import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// NOTE: Firebase の Web 設定は秘匿情報ではなく、実質的な防御は firestore.rules 側で行う。
// （他のミニアプリと同様に、この値はコミットして良い）
const firebaseConfig = {
  apiKey: 'AIzaSyAEofJl0QZd4Lvy2EUf-jphuykO11pp7TE',
  authDomain: 'kaiketsu-compass.firebaseapp.com',
  projectId: 'kaiketsu-compass',
  storageBucket: 'kaiketsu-compass.firebasestorage.app',
  messagingSenderId: '385123875952',
  appId: '1:385123875952:web:e053ce7133b9614d3408b5',
};

export const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
