import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { companyValues, type Company } from "./model";
import { saveCompany, validateImage } from "./service";

export function useCompanyEditor(
  workspaceId?: string,
  userId?: string,
  company?: Company,
) {
  const client = useQueryClient();
  const baseline = useRef(company);
  const [values, setValues] = useState(() => companyValues(company));
  const [image, setImage] = useState<File | null>(null);
  const [removed, setRemoved] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(companyValues(baseline.current)) || Boolean(image) || removed;
  const inFlight = useRef(false);
  useEffect(() => {
    if (!dirty && company?.updated_at !== baseline.current?.updated_at) {
      baseline.current = company;
      setValues(companyValues(company));
    }
  }, [company, dirty]);
  useEffect(() => {
    if (!image) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  const chooseImage = (file: File) => {
    try {
      validateImage(file);
      setImage(file);
      setRemoved(false);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = async () => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await saveCompany(
        { workspaceId: workspaceId ?? "", userId: userId ?? "" },
        values,
        baseline.current,
        image,
        removed,
      );
      client.setQueryData(["company", workspaceId, userId, saved.id], saved);
      baseline.current = saved;
      await client.invalidateQueries({ queryKey: ["companies", workspaceId] });
      await client.invalidateQueries({ predicate: q => ["pipeline-data", "pipeline-record", "lead-catalog"].includes(String(q.queryKey[1])) });
      setImage(null);
      setRemoved(false);
      setValues(companyValues(saved));
      setNotice(saved.mediaWarning??"Alterações salvas.");
      return saved;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return {
    values,
    dirty,
    setValues,
    imageUrl: preview ?? (removed ? null : company?.avatarUrl),
    chooseImage,
    removeImage: () => {
      setImage(null);
      setRemoved(true);
    },
    error,
    notice,
    saving,
    save,
  };
}
