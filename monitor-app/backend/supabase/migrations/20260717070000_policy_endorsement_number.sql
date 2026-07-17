ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS endorsement_number VARCHAR(100);
COMMENT ON COLUMN public.insurance_policies.endorsement_number IS
    'N° de endoso — análogo a policy_number pero para el endoso; algunas pólizas reportan este número desde origen aun sin archivo adjunto.';
