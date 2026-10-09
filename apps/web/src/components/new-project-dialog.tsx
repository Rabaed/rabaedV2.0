"use client";

import { Button, Dialog, DialogContent, DialogTrigger, Icon } from "@rabaed/ui";
import { useTranslations } from "next-intl";
import { CreateProjectForm } from "@/components/create-project-form";

/** "New project" for a Project Creator: the create form in a dialog. Creating a Project opens it. */
export function NewProjectDialog() {
  const t = useTranslations("projects");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Icon name="plus" size={16} />
          {t("newProject")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("createTitle")} closeLabel={t("close")}>
        <CreateProjectForm />
      </DialogContent>
    </Dialog>
  );
}
