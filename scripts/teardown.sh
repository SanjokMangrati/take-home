set -euo pipefail

export MSYS_NO_PATHCONV=1

stack="${STACK_NAME:-p6-schedule-checker}"
region="${AWS_REGION:-$(aws configure get region || true)}"

if [[ -z "$region" ]]; then
  echo "Set AWS_REGION, or a default region with aws configure." >&2
  exit 1
fi

echo "Deleting $stack in $region, including the database and every stored upload."
aws cloudformation delete-stack --region "$region" --stack-name "$stack"
aws cloudformation wait stack-delete-complete --region "$region" --stack-name "$stack"
echo "Deleted $stack."
