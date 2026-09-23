import { DASHBOARD_BODY } from "@/lib/dashboard-body";

export default function Page() {
  return <div dangerouslySetInnerHTML={{ __html: DASHBOARD_BODY }} />;
}
