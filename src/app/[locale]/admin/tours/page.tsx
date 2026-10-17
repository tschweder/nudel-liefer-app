import { AdminSectionPage } from "@/components/admin/section-page";

export default async function Page({ params }: PageProps<"/[locale]/admin/tours">) {
  const { locale } = await params;
  return <AdminSectionPage locale={locale} section="tours" />;
}
