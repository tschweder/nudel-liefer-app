import { AdminSectionPage } from "@/components/admin/section-page";

export default async function Page({ params }: PageProps<"/[locale]/admin/settings">) {
  const { locale } = await params;
  return <AdminSectionPage locale={locale} section="settings" />;
}
