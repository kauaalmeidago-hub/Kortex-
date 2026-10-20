import { useId, useState, type ReactNode } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import {
  emptyOffering,
  operatorOptions,
  productOptions,
  projectOptions,
  type CompanyValues,
} from "@/features/companies/model";

export function CompanyAvatar({
  name,
  image,
  size = "small",
}: {
  name: string;
  image?: string | null;
  size?: "small" | "card" | "profile";
}) {
  const [failedSource, setFailedSource] = useState<string>();
  return (
    <span
      className={`company-avatar company-avatar--${size}`}
      aria-hidden="true"
    >
      {image && failedSource !== image ? (
        <img src={image} alt="" onError={() => setFailedSource(image)} />
      ) : (
        name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((s) => s[0]?.toUpperCase())
          .join("") || <Upload size={20} />
      )}
    </span>
  );
}
export function CompanyField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="company-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function CompanyPhoto({
  name,
  image,
  onChange,
  onRemove,
  disabled = false,
}: {
  name: string;
  image?: string | null;
  onChange: (file: File) => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="company-photo">
      <CompanyAvatar name={name} image={image} size="profile" />
      <label htmlFor={id} className="company-link company-photo-label">
        {image ? "Alterar foto" : "Adicionar foto ou logo"}
      </label>
      <input
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={disabled}
        aria-label="Imagem da empresa"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onChange(file);
          event.target.value = "";
        }}
      />
      {image && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="company-link text-xs"
        >
          Remover imagem
        </button>
      )}
      <small className="text-muted-foreground">
        PNG, JPG ou WebP · até 5 MB
      </small>
    </div>
  );
}
export function CompanyFields({
  values,
  onChange,
  disabled = false,
}: {
  values: CompanyValues;
  onChange: (values: CompanyValues) => void;
  disabled?: boolean;
}) {
  const catalogId = useId();
  const field = (
    key: keyof Omit<CompanyValues, "offerings">,
    label: string,
    placeholder: string,
    extra = {},
  ) => (
    <CompanyField label={label}>
      <input
        name={key}
        value={values[key]}
        onChange={(event) => onChange({ ...values, [key]: event.target.value })}
        placeholder={placeholder}
        disabled={disabled}
        {...extra}
      />
    </CompanyField>
  );
  return (
    <>
      <div className="company-main-fields">
        {field("name", "Empresa", "Digite o nome da empresa", {
          required: true,
          autoComplete: "organization",
          maxLength: 200,
        })}
        {field("cnpj", "CNPJ", "Informe o CNPJ", {
          inputMode: "numeric",
          maxLength: 18,
        })}
        {field("responsible_name", "Responsável", "Informe o responsável", {
          maxLength: 200,
        })}
        {field("phone", "Telefone", "Informe o telefone", {
          type: "tel",
          autoComplete: "tel",
          maxLength: 30,
        })}
        {field("email", "E-mail", "Informe o e-mail", {
          type: "email",
          autoComplete: "email",
          maxLength: 254,
        })}
        {field("city", "Cidade", "Informe a cidade", {
          autoComplete: "address-level2",
          maxLength: 120,
        })}
      </div>
      <details className="company-form-section">
        <summary>Informações complementares</summary>
        <div className="company-complement-fields">
          <CompanyField label="Projeto">
            <select
              name="project"
              value={values.project}
              onChange={(event) =>
                onChange({ ...values, project: event.target.value })
              }
              disabled={disabled}
            >
              <option value="">Selecione o projeto</option>
              {[
                ...new Set([...projectOptions, values.project].filter(Boolean)),
              ].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </CompanyField>
          {field("industry", "Segmento", "Informe o segmento", {
            maxLength: 120,
          })}
          {field("website", "Site", "https://", {
            type: "url",
            maxLength: 500,
          })}
          {field("address", "Endereço", "Informe o endereço", {
            autoComplete: "street-address",
            maxLength: 500,
          })}
          <CompanyField label="Observações">
            <textarea
              name="notes"
              value={values.notes}
              onChange={(event) =>
                onChange({ ...values, notes: event.target.value })
              }
              placeholder="Informações complementares da empresa"
              disabled={disabled}
              rows={3}
            />
          </CompanyField>
        </div>
      </details>
      <details className="company-form-section">
        <summary>
          Produtos e operadoras
          {values.offerings.some((o) => o.product) && (
            <span className="company-count">
              {values.offerings.filter((o) => o.product).length}
            </span>
          )}
        </summary>
        <div className="company-offerings">
          <datalist id={`${catalogId}-products`}>
            {productOptions.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <datalist id={`${catalogId}-operators`}>
            {operatorOptions.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          {values.offerings.map((offering, index) => (
            <div key={index} className="company-offering-row">
              <CompanyField label={index ? `Produto ${index + 1}` : "Produto"}>
                <input
                  list={`${catalogId}-products`}
                  value={offering.product}
                  placeholder="Selecione o produto"
                  maxLength={120}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({
                      ...values,
                      offerings: values.offerings.map((o, i) =>
                        i === index ? { ...o, product: event.target.value } : o,
                      ),
                    })
                  }
                />
              </CompanyField>
              <CompanyField
                label={index ? `Operadora ${index + 1}` : "Operadora"}
              >
                <input
                  list={`${catalogId}-operators`}
                  value={offering.operator}
                  placeholder="Selecione a operadora"
                  maxLength={120}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({
                      ...values,
                      offerings: values.offerings.map((o, i) =>
                        i === index
                          ? { ...o, operator: event.target.value }
                          : o,
                      ),
                    })
                  }
                />
              </CompanyField>
              <button
                type="button"
                className="company-icon-button"
                disabled={disabled}
                aria-label={`Remover vínculo ${index + 1}`}
                onClick={() =>
                  onChange({
                    ...values,
                    offerings:
                      values.offerings.length > 1
                        ? values.offerings.filter((_, i) => i !== index)
                        : [emptyOffering()],
                  })
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="company-link inline-flex items-center gap-2"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...values,
                offerings: [...values.offerings, emptyOffering()],
              })
            }
          >
            <Plus size={16} />
            Adicionar produto e operadora
          </button>
          <p className="text-xs text-muted-foreground">
            Cada linha mantém o produto associado à sua operadora.
          </p>
        </div>
      </details>
    </>
  );
}
