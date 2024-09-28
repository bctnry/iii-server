* iii-server

An experimental gemini server

** config

``` typescript
  type Config = {
      serverList: {
	// relative to current working directory. use absolute path if
	// you want to be sure about the location of the content.
	content: string,
	host: string,
	// paths relative to `content` that you don't want people to
	// be able to gain access to.
	block?: string[],
	// if this field is undefined or the `enabled` field is false,
	// then the http proxy is not set up for this server. note that
	// http requests does not necessarily include the hostname, thus
	// we cannot pretend we are multiple servers that easily (thus
	// we have to allocate one port for each proxy.)
	proxy?: {
	    enabled: boolean,
	    port: number,
	    // site name - used in the <title> tags of the served webpages
	    // of the http proxy.
	    siteName: string,
	    css: string,
	},
	// treated as false when null/undefined.
	autoListDirectory?: boolean,
      }[],
      serverCert: string,
      serverKey: string,
      serverKeyPassword?: string,
  }

```

