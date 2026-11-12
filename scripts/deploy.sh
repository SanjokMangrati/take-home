set -euo pipefail

export MSYS_NO_PATHCONV=1

stack="${STACK_NAME:-p6-schedule-checker}"
region="${AWS_REGION:-$(aws configure get region || true)}"
template=infra/template.yaml

if [[ -z "$region" ]]; then
  echo "Set AWS_REGION, or a default region with aws configure." >&2
  exit 1
fi

stack_output() {
  aws cloudformation describe-stacks --region "$region" --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

deploy_stack() {
  local overrides=("$@")
  if [[ -n "${ALERT_EMAIL:-}" ]]; then
    overrides+=("AlertEmail=$ALERT_EMAIL")
  fi
  local arguments=(
    --region "$region"
    --stack-name "$stack"
    --template-file "$template"
    --capabilities CAPABILITY_IAM
    --no-fail-on-empty-changeset
  )
  if ((${#overrides[@]} > 0)); then
    arguments+=(--parameter-overrides "${overrides[@]}")
  fi
  aws cloudformation deploy "${arguments[@]}"
}

echo "Deploying the network, database and image repository to $region."
deploy_stack

repository="$(stack_output RepositoryUri)"
registry="${repository%%/*}"
tag="$(date -u +%Y%m%d-%H%M%S)"
image="$repository:$tag"

echo "Building and pushing $image."
aws ecr get-login-password --region "$region" |
  docker login --username AWS --password-stdin "$registry"
docker build --platform linux/amd64 --provenance=false --tag "$image" .
docker push "$image"
digest="$(aws ecr describe-images --region "$region" --repository-name "${repository#*/}" \
  --image-ids "imageTag=$tag" --query "imageDetails[0].imageDigest" --output text)"
image_digest="$repository@$digest"

echo "Deploying the service with $image_digest."
deploy_stack "ImageUri=$image_digest"

endpoint="$(stack_output ServiceEndpoint)"
if [[ "$endpoint" != http* ]]; then
  endpoint="https://$endpoint"
fi
echo "Deployed to $endpoint"
