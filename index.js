"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const google_auth_library_1 = require("google-auth-library");
const iap_1 = require("@google-cloud/iap");
const resource_manager_1 = require("@google-cloud/resource-manager");
const util_1 = require("util");
const path_1 = require("path");
const RETRY_CONFIG = {
    httpMethodsToRetry: ['GET', 'PUT', 'POST', 'HEAD', 'OPTIONS', 'DELETE'],
};
class DefaultEnhancedIdTokenProvider {
    constructor(createOpts) {
        this.client_email = createOpts.client_email;
        this.sourceClient = createOpts.sourceClient;
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
    async fetchIdToken(targetAudience, options) {
        var _a;
        await this.sourceClient.getAccessToken();
        const name = `projects/-/serviceAccounts/${this.client_email}`;
        const url = `${DefaultEnhancedIdTokenProvider.ENDPOINT}/v1/${name}:generateIdToken`;
        const data = {
            delegates: [],
            audience: targetAudience,
            includeEmail: (_a = options === null || options === void 0 ? void 0 : options.includeEmail) !== null && _a !== void 0 ? _a : true,
        };
        const res = await this.sourceClient.request({
            retry: true,
            retryConfig: RETRY_CONFIG,
            url,
            data,
            method: 'POST',
        });
        return res.data.token;
    }
}
DefaultEnhancedIdTokenProvider.ENDPOINT = 'https://iamcredentials.googleapis.com';
async function fetchEmail(auth) {
    const url = 'https://www.googleapis.com/oauth2/v3/userinfo';
    const accessToken = await auth.getAccessToken();
    const headers = {
        Authorization: `Bearer ${accessToken}`,
    };
    const res = await auth.request({
        headers,
        retry: true,
        retryConfig: RETRY_CONFIG,
        url,
    });
    return res.data.email;
}
const cachedAuthorizationHeaderValue = { expiresInMilliseconds: 0, payload: '' };
function assert(union, entity, context) {
    if (!union)
        throw {
            type: 'illegal-state/entity-not-found',
            title: `Object failed validation [${entity}]`,
            message: context !== null && context !== void 0 ? context : (0, util_1.inspect)(context, { colors: false, depth: 4 }),
        };
    return union;
}
async function createIdTokenProvider(createOptions) {
    const { projectId, targetPrincipal } = createOptions;
    // const auth = new GoogleAuth<OAuth2Client>({
    const auth = new google_auth_library_1.GoogleAuth({
        projectId,
        scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/userinfo.email'],
    });
    const sourceClient = await auth.getClient();
    if (targetPrincipal)
        return new google_auth_library_1.Impersonated({
            projectId,
            sourceClient,
            targetPrincipal,
            targetScopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/userinfo.email'],
        });
    const credentials = await auth.getCredentials();
    try {
        const client_email = credentials.client_email || (sourceClient instanceof google_auth_library_1.JWT ? sourceClient.email : undefined) || (await fetchEmail(auth));
        return new DefaultEnhancedIdTokenProvider({ sourceClient, client_email });
    }
    catch (error) {
        throw {
            type: 'service-account/not-found',
            title: 'Impersonation Needed',
            message: 'In this compute context, you MUST use service account impersonation',
            error,
        };
    }
}
async function init(initOpts) {
    const { targetPrincipal } = initOpts;
    const projectId = assert(process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT, 'projectId envars');
    const projectsClient = new resource_manager_1.ProjectsClient({ projectId });
    const [project] = await projectsClient.getProject({ name: projectsClient.projectPath(projectId) });
    const projectNumber = assert(project.name.split('/').pop(), 'ProjectsClient.project.name.projectNumber');
    const iapClient = new iap_1.IdentityAwareProxyOAuthServiceClient({ projectId });
    const [clients] = await iapClient.listIdentityAwareProxyClients({ parent: (0, path_1.join)(iapClient.projectPath(projectId), 'brands', projectNumber) });
    const appEngineClient = assert(clients.find(value => value.displayName === 'IAP-App-Engine-app'), 'IdentityAwareProxyOAuthServiceClient.find["IAP-App-Engine-app"]');
    const targetAudience = appEngineClient.name.split('/').pop();
    return [await createIdTokenProvider({ projectId, targetPrincipal }), targetAudience];
}
async function dumpToken(provider, targetAudience) {
    const token = await provider.fetchIdToken(targetAudience, { includeEmail: true });
    console.dir({ token });
}
async function main(args) {
    const targetPrincipal = args.length < 0 ? undefined : args[0];
    const [provider, targetAudience] = await init({ targetPrincipal });
    const token = await provider.fetchIdToken(targetAudience, { includeEmail: true });
    console.dir({ token });
}
main(process.argv.slice(2))
    .then(() => console.log('DONE'))
    .catch(error => {
    console.error((0, util_1.inspect)({ ERROR: error }, { colors: true, depth: 4 }));
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map