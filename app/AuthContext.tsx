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
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/app/firebase";
import { setSecureUserDoc } from "@/app/utils/secureUserDoc";
import { TeamRole, normalizeLegacyRole } from "@/app/utils/roles";
import { withHiddenOwnerPermissions } from "@/app/utils/ownerPermissions";

// User data structure
export type UserRole = TeamRole | "scout" | "coach";

export type UserData = {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  roles?: TeamRole[];
  specialRole?: string | null;
  specialRoles?: string[];
  teamId: string;
  isTeamAdmin: boolean;
  photoURL?: string;
  bio?: string;
  profileVisibility?: "team" | "public" | "private";
  preferredDashboard?: string;
  canManageVersionReleases?: boolean;
};

type AuthContextType = {
  user: User | null;
  currentUser: User | null;
  userData: UserData | null;
  loading: boolean;
  signUp: (email: string, password: string, name: string, role: UserRole, teamId: string, isTeamAdmin: boolean) => Promise<string>;
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
  signUp: async () => "",
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
        const data = userDoc.data() as UserData & { encryptedUserData?: string };
        setUserData(withHiddenOwnerPermissions(data));
        if (!data.encryptedUserData) {
          await setSecureUserDoc(uid, data, true);
        }
      }
    } catch (error) {
      console.error("Error loading user data:", error);
    }
  }

  // Update user data
  async function updateUserData(updates: Partial<UserData>) {
    if (!user) return;
    
    try {
      await setSecureUserDoc(user.uid, updates as Record<string, unknown>, true);
      setUserData(prev => (prev ? withHiddenOwnerPermissions({ ...prev, ...updates }) : null));
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
  ): Promise<string> {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const continueUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/verify-email?email=${encodeURIComponent(email)}`
        : "https://compsocrates.app/verify-email";
    await sendEmailVerification(userCredential.user, {
      url: continueUrl,
      handleCodeInApp: false,
    });
    alert("Verification email sent! Please check your inbox.");
    
    // Update display name
    await updateProfile(userCredential.user, { displayName: name });
    
    // Store user data in Firestore
    const normalizedRole = normalizeLegacyRole(role);
    const userData: UserData = {
      uid: userCredential.user.uid,
      email: email,
      displayName: name,
      role: normalizedRole,
      roles: [normalizedRole],
      teamId: teamId,
      isTeamAdmin: isTeamAdmin,
      profileVisibility: "team",
      bio: "",
    };
    
    await setSecureUserDoc(userCredential.user.uid, userData as unknown as Record<string, unknown>, false);
    return userCredential.user.uid;
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
          setUserData(withHiddenOwnerPermissions(userDoc.data() as UserData));
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
