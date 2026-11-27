import { Stack } from 'expo-router';
import { ProfileScreen } from '../auth/profile-screen';
import { PageTitle } from '../components/page-title';
export default function ProfilePage() { return <><Stack.Screen options={{title:'Mano paskyra',headerBackTitle:'Renginiai'}} /><PageTitle title="Mano paskyra · Dracula" /><ProfileScreen /></>; }
