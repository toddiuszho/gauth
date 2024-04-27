import {IdentityAwareProxyOAuthServiceClient} from '@google-cloud/iap'
import {ProjectsClient} from '@google-cloud/resource-manager'
import {AuthClient, Compute, GoogleAuth, Impersonated, JWT} from 'google-auth-library'
import {join} from 'path'
import {inspect} from 'util'
import * as yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

const RETRY_CONFIG = {
  httpMethodsToRetry: ['GET', 'PUT', 'POST', 'HEAD', 'OPTIONS', 'DELETE'],
}

type UnionJSONClientAndCompute = Awaited<ReturnType<GoogleAuth['getClient']>>
type JSONClient = Exclude<UnionJSONClientAndCompute, Compute>

interface FetchIdTokenOptions {
  /**
   * Include the service account email in the token.
   * If set to `true`, the token will contain `email` and `email_verified` claims.
   */
  includeEmail: boolean
}

interface FetchIdTokenResponse {
  /** The OpenId Connect ID token. */
  token: string
}

interface FetchUserInfoResponse {
  email: string
}

interface IEnhancedIdTokenProvider {
  fetchIdToken(targetAudience: string, options?: FetchIdTokenOptions): Promise<string>
}

type DefaultEnhancedIdProviderCreateOptions = {
  client_email: string
  sourceClient: AuthClient
}

class DefaultEnhancedIdTokenProvider implements IEnhancedIdTokenProvider {
  protected client_email: string
  protected sourceClient: AuthClient

  static ENDPOINT = 'https://iamcredentials.googleapis.com'

  constructor(createOpts: DefaultEnhancedIdProviderCreateOptions) {
    this.client_email = createOpts.client_email
    this.sourceClient = createOpts.sourceClient
  }

  /**
   * Generates an OpenID Connect ID token for a service account.
   *
   * {@link https://cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateIdToken Reference Documentation}
   *
   * @param targetAudience the audience for the fetched ID token.
   * @param options the for the request
   * @return an OpenID Connect ID token
   */
  async fetchIdToken(targetAudience: string, options?: FetchIdTokenOptions): Promise<string> {
    await this.sourceClient.getAccessToken()

    const name = `projects/-/serviceAccounts/${this.client_email}`
    const url = `${DefaultEnhancedIdTokenProvider.ENDPOINT}/v1/${name}:generateIdToken`
    const data = {
      delegates: [],
      audience: targetAudience,
      includeEmail: options?.includeEmail ?? true,
    }
    const res = await this.sourceClient.request<FetchIdTokenResponse>({
      retry: true,
      retryConfig: RETRY_CONFIG,
      url,
      data,
      method: 'POST',
    })

    return res.data.token
  }
}

async function fetchEmail(auth: GoogleAuth<JSONClient>): Promise<string> {
  const url = 'https://www.googleapis.com/oauth2/v3/userinfo'
  const accessToken = await auth.getAccessToken()
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  }
  try {
    const res = await auth.request<FetchUserInfoResponse>({
      headers,
      retry: true,
      retryConfig: RETRY_CONFIG,
      url,
    })
    return res.data.email
  } catch (error: unknown) {
    console.error(inspect({fetchEmailError: error}, {colors: true, depth: 4}))
    return ''
  }
}

function assert<T>(union: T | undefined, entity: string, context?: any): T {
  if (!union)
    throw {
      type: 'illegal-state/entity-not-found',
      title: `Object failed validation [${entity}]`,
      message: context ?? inspect(context, {colors: false, depth: 4}),
    }

  return union
}

async function createIdTokenProvider(createOptions: {
  projectId: string
  targetAudience: string
  targetPrincipal?: string
}): Promise<IEnhancedIdTokenProvider> {
  const {projectId, targetAudience, targetPrincipal} = createOptions
  // const auth = new GoogleAuth<OAuth2Client>({
  const auth = new GoogleAuth<JSONClient>({
    projectId,
    scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/userinfo.email'],
  })

  const sourceClient = await auth.getClient()

  if (targetPrincipal) {
    console.dir({providerType: 'impersonation', targetPrincipal})
    return new Impersonated({
      projectId,
      sourceClient,
      targetPrincipal,
      targetScopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/userinfo.email'],
    })
  }

  if (!isManagedRuntime()) {
    console.dir({providerType: 'adc/gcloud'})
    process.exitCode = 1
    throw {type: 'illegal-access/iap-local', title: 'Forbidden IAP from local', message: 'Use impersonation'}
  }

  console.dir({providerType: 'managed'})
  const credentials = await auth.getCredentials()
  try {
    const client_email =
      credentials.client_email || (sourceClient instanceof JWT ? (sourceClient as JWT).email : undefined) || (await fetchEmail(auth))
    return new DefaultEnhancedIdTokenProvider({sourceClient, client_email})
  } catch (error: unknown) {
    throw {
      type: 'service-account/not-found',
      title: 'Impersonation Needed',
      message: 'In this compute context, you MUST use service account impersonation',
      error,
    }
  }
}

async function init(initOpts: {targetPrincipal?: string}): Promise<[IEnhancedIdTokenProvider, string]> {
  const {targetPrincipal} = initOpts
  const projectId = assert(process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT, 'projectId envars')
  const projectsClient = new ProjectsClient({projectId})
  const [project] = await projectsClient.getProject({name: projectsClient.projectPath(projectId!)})
  const projectNumber = assert(project.name!.split('/').pop()!, 'ProjectsClient.project.name.projectNumber')
  const iapClient = new IdentityAwareProxyOAuthServiceClient({projectId})
  const [clients] = await iapClient.listIdentityAwareProxyClients({parent: join(iapClient.projectPath(projectId), 'brands', projectNumber)})
  const appEngineClient = assert(
    clients.find(value => value.displayName === 'IAP-App-Engine-app'),
    'IdentityAwareProxyOAuthServiceClient.find["IAP-App-Engine-app"]'
  )
  const targetAudience = (appEngineClient.name as string).split('/').pop()!
  return [await createIdTokenProvider({projectId, targetAudience, targetPrincipal}), targetAudience]
}

function isManagedRuntime(): boolean {
  const env = process.env
  return !!(env.GOOGLE_CLOUD_REGION || env.GAE_SERVICE)
}

async function main(args: string[]): Promise<void> {
  const parser = yargs(args)
    .options({
      'target-principal': {type: 'string', require: false, description: 'impersonate a service account'},
    })
    .version('1.0')
    .strictOptions(true)
  const argv = await parser.parseAsync()
  const {targetPrincipal} = argv
  const [provider, targetAudience] = await init({targetPrincipal})
  const token = await provider.fetchIdToken(targetAudience, {includeEmail: true})
  console.dir({token})
}

main(hideBin(process.argv))
  .then(() => console.log('DONE'))
  .catch(error => {
    console.error(inspect({ERROR: error}, {colors: true, depth: 4}))
    process.exitCode = 1
  })
