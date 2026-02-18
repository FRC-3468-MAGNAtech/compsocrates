"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendEmailVerification
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "@/app/firebase";

// User data structure
export type UserRole = "scout" | "coach";
export type SpecialRole = "lead-scout" | "lead-strategist" | "pit-scout" | null;

export type UserData = {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  specialRole?: SpecialRole;
  specialRoles?: string[];
  teamId: string;
  isTeamAdmin: boolean;
  photoURL?: string;
  bio?: string;
  profileVisibility?: "team" | "public" | "private";
};

type AuthContextType = {
  user: User | null;
  currentUser: User | null;
  userData: UserData | null;
  loading: boolean;
  signUp: (email: string, password: string, name: string, role: UserRole, teamId: string, isTeamAdmin: boolean) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
  updateUserData: (updates: Partial<UserData>) => Promise<void>;
  refreshUserData: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  currentUser: null,
  userData: null,
  loading: true,
  signUp: async () => {},
  signIn: async () => {},
  logOut: async () => {},
  updateUserData: async () => {},
  refreshUserData: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Load user data from Firestore
  async function loadUserData(uid: string) {
    try {
      const userDoc = await getDoc(doc(db, "users", uid));
      if (userDoc.exists()) {
        setUserData(userDoc.data() as UserData);
      }
    } catch (error) {
      console.error("Error loading user data:", error);
    }
  }

  // Update user data
  async function updateUserData(updates: Partial<UserData>) {
    if (!user) return;
    
    try {
      await setDoc(doc(db, "users", user.uid), updates, { merge: true });
      setUserData(prev => prev ? { ...prev, ...updates } : null);
    } catch (error) {
      console.error("Error updating user data:", error);
      throw error;
    }
  }

  // Refresh user data from Firestore
  async function refreshUserData() {
    if (!user) return;
    await loadUserData(user.uid);
  }

  // Sign up new user
  async function signUp(
    email: string, 
    password: string, 
    name: string, 
    role: UserRole, 
    teamId: string,
    isTeamAdmin: boolean
  ) {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(userCredential.user);
    alert("Verification email sent! Please check your inbox.");
    
    // Update display name
    await updateProfile(userCredential.user, { displayName: name });
    
    // Store user data in Firestore
    const userData: UserData = {
      uid: userCredential.user.uid,
      email: email,
      displayName: name,
      role: role,
      specialRole: null,
      specialRoles: [],
      teamId: teamId,
      isTeamAdmin: isTeamAdmin,
      profileVisibility: "team",
      bio: "",
    };
    
    await setDoc(doc(db, "users", userCredential.user.uid), userData);
  }

  // Sign in existing user
  async function signIn(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password);
  }

  // Log out
  async function logOut() {
    await signOut(auth);
    setUser(null);
    setUserData(null);
  }

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        // Check if email is verified
        if (!currentUser.emailVerified) {
          // Redirect to verification page
          router.push("/verify-email");
          setLoading(false);
          return;
        }

        // Load user data
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        if (userDoc.exists()) {
          setUserData(userDoc.data() as UserData);
        }
      } else {
        setUserData(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, [router]);

  return (
    <AuthContext.Provider value={{ 
      user, 
      currentUser: user,
      userData, 
      loading, 
      signUp, 
      signIn, 
      logOut, 
      updateUserData,
      refreshUserData
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
