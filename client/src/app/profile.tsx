import { Stack } from 'expo-router';
import { ProfileScreen } from '../auth/profile-screen';
export default function ProfilePage() { return <><Stack.Screen options={{title:'Mano paskyra',headerBackTitle:'Renginiai'}} /><ProfileScreen /></>; }
