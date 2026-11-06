import { handle } from "@/lib/api";
import { getCurrentUser, listContacts } from "@/lib/users";

export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    return { contacts: await listContacts(user.id) };
  });
}
