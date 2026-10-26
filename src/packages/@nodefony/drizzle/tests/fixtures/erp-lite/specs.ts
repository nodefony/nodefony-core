/**
 * Descriptions d'entités NEUTRES du corpus synthétique — GÉNÉRÉ par
 * `.claude/skills/nodefony-devkit-bench/scripts/mysql-ddl-to-specs.mjs`
 * depuis `ddl/`, ne pas éditer : modifier le DDL, puis régénérer.
 */
export const SPECS = [
  {
    name: "erp_category",
    columns: {
      rowid: {
        kind: "serial",
        primaryKey: true,
      },
      entity: {
        kind: "int",
        notNull: true,
        default: 1,
      },
      fk_parent: {
        kind: "int",
        notNull: true,
        default: 0,
      },
      label: {
        kind: "string",
        length: 180,
        notNull: true,
      },
      type: {
        kind: "int",
        notNull: true,
        default: 1,
      },
      color: {
        kind: "string",
        length: 8,
      },
      position: {
        kind: "int",
        default: 0,
      },
      visible: {
        kind: "int",
        notNull: true,
        default: 1,
      },
    },
    indexes: [
      {
        name: "uk_category_ref",
        on: ["entity", "fk_parent", "label", "type"],
        unique: true,
      },
    ],
  },
  {
    name: "erp_category_product",
    columns: {
      rowid: {
        kind: "serial",
        primaryKey: true,
      },
      fk_category: {
        kind: "ref",
        target: "erp_category",
        notNull: true,
      },
      fk_product: {
        kind: "ref",
        target: "erp_product",
        notNull: true,
      },
      import_key: {
        kind: "string",
        length: 14,
      },
    },
    indexes: [
      {
        name: "pk_category_product",
        on: ["fk_category", "fk_product"],
        unique: true,
      },
      {
        name: "idx_category_product_fk_category",
        on: ["fk_category"],
      },
      {
        name: "idx_category_product_fk_product",
        on: ["fk_product"],
      },
    ],
  },
  {
    name: "erp_const",
    columns: {
      rowid: {
        kind: "serial",
        primaryKey: true,
      },
      name: {
        kind: "string",
        length: 180,
        notNull: true,
      },
      entity: {
        kind: "int",
        notNull: true,
        default: 1,
      },
      value: {
        kind: "text",
        notNull: true,
      },
      type: {
        kind: "string",
        length: 64,
        default: "chaine",
      },
      visible: {
        kind: "int",
        notNull: true,
        default: 1,
      },
      note: {
        kind: "text",
      },
      label: {
        kind: "string",
        length: 128,
        default: "l'été",
      },
      enabled: {
        kind: "bool",
        notNull: true,
        default: true,
      },
      composed_of: {
        kind: "json",
      },
      history: {
        kind: "text",
      },
      tms: {
        kind: "datetime",
        defaultFn: "now",
        onUpdateFn: "now",
      },
    },
    indexes: [
      {
        name: "uk_const",
        on: ["name", "entity"],
        unique: true,
      },
    ],
  },
  {
    name: "erp_country",
    columns: {
      rowid: {
        kind: "serial",
        primaryKey: true,
      },
      code: {
        kind: "string",
        length: 2,
        notNull: true,
      },
      code_iso: {
        kind: "string",
        length: 3,
      },
      label: {
        kind: "string",
        length: 128,
      },
      active: {
        kind: "int",
        notNull: true,
        default: 1,
      },
    },
    indexes: [
      {
        name: "uk_code",
        on: ["code"],
        unique: true,
      },
    ],
  },
  {
    name: "erp_currency",
    columns: {
      code_iso: {
        kind: "string",
        length: 3,
        primaryKey: true,
      },
      label: {
        kind: "string",
        length: 128,
      },
      unicode: {
        kind: "string",
        length: 32,
      },
      active: {
        kind: "int",
        notNull: true,
        default: 1,
      },
    },
  },
  {
    name: "erp_event",
    columns: {
      id: {
        kind: "serial",
        primaryKey: true,
      },
      ref: {
        kind: "string",
        length: 30,
        notNull: true,
      },
      uid: {
        kind: "char",
        length: 36,
      },
      entity: {
        kind: "int",
        notNull: true,
        default: 1,
      },
      datep: {
        kind: "datetime",
      },
      datep2: {
        kind: "datetime",
      },
      fk_action: {
        kind: "int",
      },
      code: {
        kind: "string",
        length: 50,
      },
      label: {
        kind: "string",
        length: 255,
        notNull: true,
      },
      durationp: {
        kind: "float",
      },
      fulldayevent: {
        kind: "int",
        default: 0,
      },
      percent: {
        kind: "int",
        notNull: true,
        default: 0,
      },
      location: {
        kind: "string",
        length: 128,
      },
      priority: {
        kind: "int",
      },
      transparency: {
        kind: "int",
      },
      note: {
        kind: "text",
      },
      email_msgid: {
        kind: "string",
        length: 255,
      },
      email_subject: {
        kind: "string",
        length: 255,
      },
      extraparams: {
        kind: "string",
        length: 255,
      },
      status: {
        kind: "int",
        notNull: true,
        default: -1,
      },
      ip: {
        kind: "string",
        length: 250,
      },
    },
  },
  {
    name: "erp_invoice",
    columns: {
      rowid: {
        kind: "serial",
        primaryKey: true,
      },
      ref: {
        kind: "string",
        length: 30,
        notNull: true,
      },
      entity: {
        kind: "int",
        notNull: true,
        default: 1,
      },
      type: {
        kind: "int",
        notNull: true,
        default: 0,
      },
      fk_soc: {
        kind: "ref",
        target: "erp_thirdparty",
        notNull: true,
      },
      datec: {
        kind: "datetime",
      },
      datef: {
        kind: "date",
      },
      date_valid: {
        kind: "date",
      },
      tms: {
        kind: "datetime",
        defaultFn: "now",
        onUpdateFn: "now",
      },
      paye: {
        kind: "int",
        notNull: true,
        default: 0,
      },
      close_code: {
        kind: "string",
        length: 16,
      },
      total_tva: {
        kind: "decimal",
        precision: 24,
        scale: 8,
        default: "0",
      },
      total_ht: {
        kind: "decimal",
        precision: 24,
        scale: 8,
        default: "0",
      },
      total_ttc: {
        kind: "decimal",
        precision: 24,
        scale: 8,
        default: "0",
      },
      multicurrency_tx: {
        kind: "decimal",
        precision: 24,
        scale: 8,
        default: "1",
      },
      fk_statut: {
        kind: "int",
        notNull: true,
        default: 0,
      },
      fk_user_author: {
        kind: "ref",
        target: "erp_user",
      },
      fk_facture_source: {
        kind: "ref",
        target: "self",
      },
      fk_currency: {
        kind: "ref",
        target: "erp_currency",
      },
      note_private: {
        kind: "text",
      },
      model_pdf: {
        kind: "string",
        length: 255,
      },
      last_main_doc: {
        kind: "string",
        length: 255,
      },
      extraparams: {
        kind: "string",
        length: 255,
      },
      pos_print_counter: {
        kind: "int",
        default: 0,
      },
    },
    indexes: [
      {
        name: "uk_invoice_ref",
        on: ["ref", "entity"],
        unique: true,
      },
      {
        name: "idx_invoice_fk_soc",
        on: ["fk_soc"],
      },
      {
        name: "idx_invoice_datef",
        on: ["datef"],
      },
    ],
  },
  {
    name: "erp_invoice_line",
    columns: {
      rowid: {
        kind: "serial",
        primaryKey: true,
      },
      fk_invoice: {
        kind: "ref",
        target: "erp_invoice",
        notNull: true,
      },
      fk_parent_line: {
        kind: "int",
      },
      fk_product: {
        kind: "ref",
        target: "erp_product",
      },
      label: {
        kind: "string",
        length: 255,
      },
      description: {
        kind: "text",
      },
      vat_src_code: {
        kind: "string",
        length: 10,
        default: "",
      },
      tva_tx: {
        kind: "decimal",
        precision: 7,
        scale: 4,
      },
      qty: {
        kind: "float",
      },
      remise_percent: {
        kind: "float",
        default: 0,
      },
      subprice: {
        kind: "decimal",
        precision: 24,
        scale: 8,
      },
      total_ht: {
        kind: "decimal",
        precision: 24,
        scale: 8,
      },
      total_ttc: {
        kind: "decimal",
        precision: 24,
        scale: 8,
      },
      product_type: {
        kind: "int",
        default: 0,
      },
      date_start: {
        kind: "datetime",
      },
      info_bits: {
        kind: "int",
        default: 0,
      },
      special_code: {
        kind: "int64",
        default: 0,
      },
      rang: {
        kind: "int",
        default: 0,
      },
      situation_percent: {
        kind: "float",
        default: 100,
      },
      extraparams: {
        kind: "string",
        length: 255,
      },
    },
    indexes: [
      {
        name: "idx_invoice_line_fk_invoice",
        on: ["fk_invoice"],
      },
      {
        name: "idx_invoice_line_fk_product",
        on: ["fk_product"],
      },
    ],
  },
  {
    name: "erp_product",
    columns: {
      rowid: {
        kind: "serial",
        primaryKey: true,
      },
      ref: {
        kind: "string",
        length: 128,
        notNull: true,
      },
      entity: {
        kind: "int",
        notNull: true,
        default: 1,
      },
      label: {
        kind: "string",
        length: 255,
        notNull: true,
      },
      description: {
        kind: "text",
      },
      datec: {
        kind: "datetime",
      },
      tms: {
        kind: "datetime",
        defaultFn: "now",
        onUpdateFn: "now",
      },
      price: {
        kind: "decimal",
        precision: 24,
        scale: 8,
        default: "0",
      },
      price_ttc: {
        kind: "decimal",
        precision: 24,
        scale: 8,
        default: "0",
      },
      tva_tx: {
        kind: "decimal",
        precision: 7,
        scale: 4,
      },
      tosell: {
        kind: "int",
        default: 1,
      },
      finished: {
        kind: "int",
      },
      weight: {
        kind: "float",
      },
      barcode: {
        kind: "string",
        length: 180,
      },
      stock: {
        kind: "float",
      },
      duration: {
        kind: "string",
        length: 6,
      },
      fk_unit: {
        kind: "int",
      },
      extra_counter: {
        kind: "int64",
      },
      special_code: {
        kind: "int64",
        default: 0,
      },
    },
    indexes: [
      {
        name: "uk_product_ref",
        on: ["ref", "entity"],
        unique: true,
      },
      {
        name: "uk_product_barcode",
        on: ["barcode", "entity"],
        unique: true,
      },
      {
        name: "idx_product_label",
        on: ["label"],
      },
    ],
  },
  {
    name: "erp_product_nature",
    columns: {
      rowid: {
        kind: "serial",
        primaryKey: true,
      },
      code: {
        kind: "int",
        notNull: true,
      },
      label: {
        kind: "string",
        length: 100,
      },
      active: {
        kind: "int",
        notNull: true,
        default: 1,
      },
    },
    indexes: [
      {
        name: "uk_code_product_nature",
        on: ["code"],
        unique: true,
      },
    ],
  },
  {
    name: "erp_thirdparty",
    columns: {
      rowid: {
        kind: "serial",
        primaryKey: true,
      },
      nom: {
        kind: "string",
        length: 128,
      },
      name_alias: {
        kind: "string",
        length: 128,
      },
      entity: {
        kind: "int",
        notNull: true,
        default: 1,
      },
      ref_ext: {
        kind: "string",
        length: 255,
      },
      statut: {
        kind: "int",
        default: 0,
      },
      status: {
        kind: "int",
        default: 1,
      },
      code_client: {
        kind: "string",
        length: 24,
      },
      tms: {
        kind: "datetime",
        defaultFn: "now",
        onUpdateFn: "now",
      },
      datec: {
        kind: "datetime",
      },
      address: {
        kind: "string",
        length: 255,
      },
      zip: {
        kind: "string",
        length: 25,
      },
      fk_country: {
        kind: "int",
        default: 0,
      },
      fk_currency: {
        kind: "ref",
        target: "erp_currency",
      },
      phone: {
        kind: "string",
        length: 20,
      },
      capital: {
        kind: "decimal",
        precision: 24,
        scale: 8,
      },
      remise_client: {
        kind: "float",
        default: 0,
      },
      note_private: {
        kind: "text",
      },
      note_public: {
        kind: "text",
      },
      default_lang: {
        kind: "string",
        length: 6,
      },
      logo: {
        kind: "string",
        length: 255,
      },
      fk_user_creat: {
        kind: "ref",
        target: "erp_user",
      },
      import_key: {
        kind: "string",
        length: 14,
      },
    },
    indexes: [
      {
        name: "uk_thirdparty_code_client",
        on: ["code_client", "entity"],
        unique: true,
      },
      {
        name: "idx_thirdparty_user_creat",
        on: ["fk_user_creat"],
      },
      {
        name: "idx_thirdparty_nom",
        on: ["nom"],
      },
    ],
  },
  {
    name: "erp_thirdparty_extrafields_long_named",
    columns: {
      rowid: {
        kind: "serial",
        primaryKey: true,
      },
      tms: {
        kind: "datetime",
        defaultFn: "now",
        onUpdateFn: "now",
      },
      fk_object: {
        kind: "ref",
        target: "erp_thirdparty",
        notNull: true,
      },
      ref_external_system_code: {
        kind: "string",
        length: 64,
      },
      import_key: {
        kind: "string",
        length: 14,
      },
    },
    indexes: [
      {
        name: "uk_thirdparty_extrafields_long_named_fk_object",
        on: ["fk_object"],
        unique: true,
      },
    ],
  },
  {
    name: "erp_user",
    columns: {
      rowid: {
        kind: "serial",
        primaryKey: true,
      },
      entity: {
        kind: "int",
        notNull: true,
        default: 1,
      },
      login: {
        kind: "string",
        length: 50,
        notNull: true,
      },
      lastname: {
        kind: "string",
        length: 50,
      },
      email: {
        kind: "string",
        length: 255,
      },
      admin: {
        kind: "int",
        default: 0,
      },
      statut: {
        kind: "int",
        default: 1,
      },
      datec: {
        kind: "datetime",
      },
      tms: {
        kind: "datetime",
        defaultFn: "now",
        onUpdateFn: "now",
      },
      fk_country: {
        kind: "ref",
        target: "erp_country",
      },
      signature: {
        kind: "text",
      },
    },
    indexes: [
      {
        name: "uk_user_login",
        on: ["login", "entity"],
        unique: true,
      },
      {
        name: "idx_user_fk_country",
        on: ["fk_country"],
      },
    ],
  },
  {
    name: "erp_user_param",
    columns: {
      rowid: {
        kind: "serial",
        primaryKey: true,
      },
      fk_user: {
        kind: "ref",
        target: "erp_user",
        notNull: true,
      },
      entity: {
        kind: "int",
        notNull: true,
        default: 1,
      },
      param: {
        kind: "string",
        length: 180,
        notNull: true,
      },
      value: {
        kind: "text",
        notNull: true,
      },
    },
    indexes: [
      {
        name: "uk_user_param",
        on: ["fk_user", "param", "entity"],
        unique: true,
      },
    ],
  },
] as const;

/** Écarts que la conversion a tranchés — chacun est une décision. */
export const NOTES = [
  {
    code: "index-prefix",
    table: "erp_thirdparty",
    column: "nom",
    detail: "préfixe d'index retiré",
  },
  {
    code: "pk-composite",
    table: "erp_category_product",
    column: "rowid",
    detail:
      "clé composite (fk_category, fk_product) → clé rowid + index unique",
  },
  {
    code: "pk-int-serial",
    table: "erp_country",
    column: "rowid",
    detail: "clé entière non auto-incrémentée → serial",
  },
  {
    code: "float",
    table: "erp_event",
    column: "durationp",
    detail: "real sans échelle → float",
  },
  {
    code: "ref-default",
    table: "erp_invoice",
    column: "fk_user_author",
    detail: "défaut 0 retiré d'une référence",
  },
  {
    code: "float",
    table: "erp_invoice_line",
    column: "qty",
    detail: "real sans échelle → float",
  },
  {
    code: "float",
    table: "erp_invoice_line",
    column: "remise_percent",
    detail: "real sans échelle → float",
  },
  {
    code: "unsigned-widened",
    table: "erp_invoice_line",
    column: "special_code",
    detail: "integer unsigned → int64",
  },
  {
    code: "float",
    table: "erp_invoice_line",
    column: "situation_percent",
    detail: "real sans échelle → float",
  },
  {
    code: "fk-not-key",
    table: "erp_product",
    column: "finished",
    detail:
      "vise une colonne qui n'est pas la clé : finished → erp_product_nature(code)",
  },
  {
    code: "float",
    table: "erp_product",
    column: "weight",
    detail: "float sans échelle → float",
  },
  {
    code: "float",
    table: "erp_product",
    column: "stock",
    detail: "real sans échelle → float",
  },
  {
    code: "unsigned-widened",
    table: "erp_product",
    column: "special_code",
    detail: "integer unsigned → int64",
  },
  {
    code: "float",
    table: "erp_thirdparty",
    column: "remise_client",
    detail: "real sans échelle → float",
  },
  {
    code: "type-unsupported",
    table: "erp_thirdparty",
    column: "geopoint",
    detail: "type point sans genre portable : colonne retirée",
  },
  {
    code: "pk-added",
    table: "erp_user_param",
    column: "rowid",
    detail: "table sans clé primaire : clé ajoutée",
  },
  {
    code: "index-renamed",
    table: "erp_product_nature",
    detail:
      "index uk_code déjà porté par erp_country : renommé uk_code_product_nature",
  },
] as const;
