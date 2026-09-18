Title: podman-run — Podman documentation

URL Source: https://docs.podman.io/en/latest/markdown/podman-run.1.html

Published Time: Fri, 21 Aug 2026 19:26:03 GMT

Markdown Content:

## OPTIONS[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#options "Link to this heading")

## **--add-host**=_hostname[;hostname[;…]]_:_ip_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#add-host-hostname-hostname-ip "Link to this heading")

Add a custom host-to-IP mapping to the container’s `/etc/hosts` file.

The option takes one or multiple semicolon-separated hostnames to be mapped to a single IPv4 or IPv6 address, separated by a colon. It can also be used to overwrite the IP addresses of hostnames Podman adds to `/etc/hosts` by default (also see the **--name** and **--hostname** options). This option can be specified multiple times to add additional mappings to `/etc/hosts`. It conflicts with the **--no-hosts** option and conflicts with _no\_hosts=true_ in `containers.conf`.

Instead of an IP address, the special flag _host-gateway_ can be given. This resolves to an IP address the container can use to connect to the host. The IP address chosen depends on your network setup, thus there’s no guarantee that Podman can determine the _host-gateway_ address automatically, which will then cause Podman to fail with an error message. You can overwrite this IP address using the _host\_containers\_internal\_ip_ option in _containers.conf_.

The _host-gateway_ address is also used by Podman to automatically add the `host.containers.internal` and `host.docker.internal` hostnames to `/etc/hosts`. You can prevent that by either giving the **--no-hosts** option, or by setting _host\_containers\_internal\_ip=”none”_ in _containers.conf_. If no _host-gateway_ address was configured manually and Podman fails to determine the IP address automatically, Podman will silently skip adding these internal hostnames to `/etc/hosts`. If Podman is running in a virtual machine using `podman machine` (this includes Mac and Windows hosts), Podman will silently skip adding the internal hostnames to `/etc/hosts`, unless an IP address was configured manually; the internal hostnames are resolved by the gvproxy DNS resolver instead.

Podman will use the `/etc/hosts` file of the host as a basis by default, i.e. any hostname present in this file will also be present in the `/etc/hosts` file of the container. A different base file can be configured using the _base\_hosts\_file_ config in `containers.conf`.

## **--annotation**=_key=value_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#annotation-key-value "Link to this heading")

Add an annotation to the container. This option can be set multiple times.

## **--arch**=_ARCH_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#arch-arch "Link to this heading")

Override the architecture, defaults to the host, of the image to be pulled. For example, `arm`. Unless overridden, subsequent lookups of the same image in the local storage matches this architecture, regardless of the host.

## **--attach**, **-a**=_stdin_ | _stdout_ | _stderr_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#attach-a-stdin-stdout-stderr "Link to this heading")

Attach to STDIN, STDOUT or STDERR.

In foreground mode (the default when **-d** is not specified), **podman run** can start the process in the container and attach the console to the process’s standard input, output, and error. It can even pretend to be a TTY (this is what most command-line executables expect) and pass along signals. The **-a** option can be set for each of **stdin**, **stdout**, and **stderr**.

## **--authfile**=_path_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#authfile-path "Link to this heading")

Path of the authentication file. Default is `${XDG_RUNTIME_DIR}/containers/auth.json` on Linux, and `$HOME/.config/containers/auth.json` on Windows/macOS. The file is created by **[podman login](https://docs.podman.io/en/latest/markdown/podman-login.1.html)**. If the authorization state is not found there, `$HOME/.docker/config.json` is checked, which is set using **docker login**.

Note: There is also the option to override the default path of the authentication file by setting the `REGISTRY_AUTH_FILE` environment variable. This can be done with **export REGISTRY_AUTH_FILE=_path_**.

## **--blkio-weight**=_weight_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#blkio-weight-weight "Link to this heading")

Block IO relative weight. The _weight_ is a value between **10** and **1000**.

This option is not supported on cgroups V1 rootless systems.

## **--blkio-weight-device**=_device:weight_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#blkio-weight-device-device-weight "Link to this heading")

Block IO relative device weight.

## **--cap-add**=_capability_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cap-add-capability "Link to this heading")

Add Linux capabilities.

Granting additional capabilities increases the privileges of the processes running inside the container and potentially allow it to break out of confinement. Capabilities like `CAP_SYS_ADMIN`, `CAP_SYS_PTRACE`, `CAP_MKNOD` and `CAP_SYS_MODULE` are particularly dangerous when they are not used within a user namespace. Please refer to **user_namespaces(7)** for a more detailed explanation of the interaction between user namespaces and capabilities.

Before adding any capability, review its security implications and ensure it is really necessary for the container’s functionality. See **capabilities(7)** for more information.

## **--cap-drop**=_capability_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cap-drop-capability "Link to this heading")

Drop these capabilities from the default podman capability set, or `all` to drop all capabilities.

This is a space separated list of capabilities.

## **--cert-dir**=_path_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cert-dir-path "Link to this heading")

Use certificates at _path_ (*.crt, *.cert, *.key) to connect to the registry. (Default: /etc/containers/certs.d) For details, see **[containers-certs.d(5)](https://github.com/containers/image/blob/main/docs/containers-certs.d.5.md)**. (This option is not available with the remote Podman client, including Mac and Windows (excluding WSL2) machines)

## **--cgroup-conf**=_KEY=VALUE_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cgroup-conf-key-value "Link to this heading")

When running on cgroup v2, specify the cgroup file to write to and its value. For example **--cgroup-conf=memory.high=1073741824** sets the memory.high limit to 1GB.

## **--cgroup-parent**=_path_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cgroup-parent-path "Link to this heading")

Path to cgroups under which the cgroup for the container is created. If the path is not absolute, the path is considered to be relative to the cgroups path of the init process. Cgroups are created if they do not already exist.

## **--cgroupns**=_mode_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cgroupns-mode "Link to this heading")

Set the cgroup namespace mode for the container.

- **host**: use the host’s cgroup namespace inside the container.

- **container:**_id_: join the namespace of the specified container.

- **private**: create a new cgroup namespace.

- **ns:**_path_: join the namespace at the specified path.

If the host uses cgroups v1, the default is set to **host**. On cgroups v2, the default is **private**.

## **--cgroups**=_how_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cgroups-how "Link to this heading")

Determines whether the container creates cgroups.

Default is **enabled**.

The **enabled** option creates a new cgroup under the cgroup-parent. The **disabled** option forces the container to not create cgroups, and thus conflicts with cgroup options (**--cgroupns** and **--cgroup-parent**). The **no-conmon** option disables a new cgroup only for the **conmon** process. The **split** option splits the current cgroup in two sub-cgroups: one for conmon and one for the container payload. It is not possible to set **--cgroup-parent** with **split**.

## **--chrootdirs**=_path_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#chrootdirs-path "Link to this heading")

Path to a directory inside the container that is treated as a `chroot` directory. Any Podman managed file (e.g., /etc/resolv.conf, /etc/hosts, /etc/hostname) that is mounted into the root directory is mounted into that location as well. Multiple directories are separated with a comma.

## **--cidfile**=_file_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cidfile-file "Link to this heading")

Write the container ID to _file_. The file is removed along with the container, except when used with podman --remote run on detached containers.

## **--conmon-pidfile**=_file_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#conmon-pidfile-file "Link to this heading")

Write the pid of the **conmon** process to a file. As **conmon** runs in a separate process than Podman, this is necessary when using systemd to restart Podman containers. (This option is not available with the remote Podman client, including Mac and Windows (excluding WSL2) machines)

## **--cpu-period**=_limit_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cpu-period-limit "Link to this heading")

Set the CPU period for the Completely Fair Scheduler (CFS), which is a duration in microseconds. Once the container’s CPU quota is used up, it will not be scheduled to run until the current period ends. Defaults to 100000 microseconds.

On some systems, changing the resource limits may not be allowed for non-root users. For more details, see https://github.com/containers/podman/blob/main/troubleshooting.md#26-running-containers-with-resource-limits-fails-with-a-permissions-error

This option is not supported on cgroups V1 rootless systems.

## **--cpu-quota**=_limit_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cpu-quota-limit "Link to this heading")

Limit the CPU Completely Fair Scheduler (CFS) quota.

Limit the container’s CPU usage. By default, containers run with the full CPU resource. The limit is a number in microseconds. If a number is provided, the container is allowed to use that much CPU time until the CPU period ends (controllable via **--cpu-period**).

On some systems, changing the resource limits may not be allowed for non-root users. For more details, see https://github.com/containers/podman/blob/main/troubleshooting.md#26-running-containers-with-resource-limits-fails-with-a-permissions-error

This option is not supported on cgroups V1 rootless systems.

## **--cpu-rt-period**=_microseconds_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cpu-rt-period-microseconds "Link to this heading")

Limit the CPU real-time period in microseconds.

Limit the container’s Real Time CPU usage. This option tells the kernel to restrict the container’s Real Time CPU usage to the period specified.

This option is only supported on cgroups V1 rootful systems.

## **--cpu-rt-runtime**=_microseconds_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cpu-rt-runtime-microseconds "Link to this heading")

Limit the CPU real-time runtime in microseconds.

Limit the containers Real Time CPU usage. This option tells the kernel to limit the amount of time in a given CPU period Real Time tasks may consume. Ex: Period of 1,000,000us and Runtime of 950,000us means that this container can consume 95% of available CPU and leave the remaining 5% to normal priority tasks.

The sum of all runtimes across containers cannot exceed the amount allotted to the parent cgroup.

This option is only supported on cgroups V1 rootful systems.

## **--cpu-shares**, **-c**=_shares_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cpu-shares-c-shares "Link to this heading")

CPU shares (relative weight).

By default, all containers get the same proportion of CPU cycles. This proportion can be modified by changing the container’s CPU share weighting relative to the combined weight of all the running containers. Default weight is **1024**.

The proportion only applies when CPU-intensive processes are running. When tasks in one container are idle, other containers can use the left-over CPU time. The actual amount of CPU time varies depending on the number of containers running on the system.

For example, consider three containers, one has a cpu-share of 1024 and two others have a cpu-share setting of 512. When processes in all three containers attempt to use 100% of CPU, the first container receives 50% of the total CPU time. If a fourth container is added with a cpu-share of 1024, the first container only gets 33% of the CPU. The remaining containers receive 16.5%, 16.5% and 33% of the CPU.

On a multi-core system, the shares of CPU time are distributed over all CPU cores. Even if a container is limited to less than 100% of CPU time, it can use 100% of each individual CPU core.

For example, consider a system with more than three cores. If the container _C0_ is started with **--cpu-shares=512** running one process, and another container _C1_ with **--cpu-shares=1024** running two processes, this can result in the following division of CPU shares:

| PID | container | CPU | CPU share    |
| --- | --------- | --- | ------------ |
| 100 | C0        | 0   | 100% of CPU0 |
| 101 | C1        | 1   | 100% of CPU1 |
| 102 | C1        | 2   | 100% of CPU2 |

On some systems, changing the resource limits may not be allowed for non-root users. For more details, see https://github.com/containers/podman/blob/main/troubleshooting.md#26-running-containers-with-resource-limits-fails-with-a-permissions-error

This option is not supported on cgroups V1 rootless systems.

## **--cpus**=_number_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cpus-number "Link to this heading")

Number of CPUs. The default is _0.0_ which means no limit. This is shorthand for **--cpu-period** and **--cpu-quota**, therefore the option cannot be specified with **--cpu-period** or **--cpu-quota**.

On some systems, changing the CPU limits may not be allowed for non-root users. For more details, see https://github.com/containers/podman/blob/main/troubleshooting.md#26-running-containers-with-resource-limits-fails-with-a-permissions-error

This option is not supported on cgroups V1 rootless systems.

## **--cpuset-cpus**=_number_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cpuset-cpus-number "Link to this heading")

CPUs in which to allow execution. Can be specified as a comma-separated list (e.g. **0,1**), as a range (e.g. **0-3**), or any combination thereof (e.g. **0-3,7,11-15**).

On some systems, changing the resource limits may not be allowed for non-root users. For more details, see https://github.com/containers/podman/blob/main/troubleshooting.md#26-running-containers-with-resource-limits-fails-with-a-permissions-error

This option is not supported on cgroups V1 rootless systems.

## **--cpuset-mems**=_nodes_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#cpuset-mems-nodes "Link to this heading")

Memory nodes (MEMs) in which to allow execution (0-3, 0,1). Only effective on NUMA systems.

If there are four memory nodes on the system (0-3), use **--cpuset-mems=0,1** then processes in the container only uses memory from the first two memory nodes.

On some systems, changing the resource limits may not be allowed for non-root users. For more details, see https://github.com/containers/podman/blob/main/troubleshooting.md#26-running-containers-with-resource-limits-fails-with-a-permissions-error

This option is not supported on cgroups V1 rootless systems.

## **--creds**=_[username[:password]]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#creds-username-password "Link to this heading")

The [username[:password]] to use to authenticate with the registry, if required. If one or both values are not supplied, a command line prompt appears and the value can be entered. The password is entered without echo.

Note that the specified credentials are only used to authenticate against target registries. They are not used for mirrors or when the registry gets rewritten (see `containers-registries.conf(5)`); to authenticate against those consider using a `containers-auth.json(5)` file.

## **--decryption-key**=_key[:passphrase]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#decryption-key-key-passphrase "Link to this heading")

The [key[:passphrase]] to be used for decryption of images. Key can point to keys and/or certificates. Decryption is tried with all keys. If the key is protected by a passphrase, it is required to be passed in the argument and omitted otherwise.

## **--detach**, **-d**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#detach-d "Link to this heading")

Detached mode: run the container in the background and print the new container ID. The default is _false_.

At any time run **podman ps** in the other shell to view a list of the running containers. Reattach to a detached container with **podman attach** command.

When attached via tty mode, detach from the container (and leave it running) using a configurable key sequence. The default sequence is `ctrl-p,ctrl-q`. Specify the key sequence using the **--detach-keys** option, or configure it in the **containers.conf** file: see **containers.conf(5)** for more information.

## **--detach-keys**=_sequence_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#detach-keys-sequence "Link to this heading")

Specify the key sequence for detaching a container. Format is a single character `[a-Z]` or a comma separated sequence of `ctrl-<value>`, where `<value>` is one of: `a-z`, `@`, `[`, `\`, `]`, `^` or `_`. Specifying “” disables this feature. The default is _ctrl-p,ctrl-q_.

This option can also be set in **containers.conf**(5) file.

## **--device**=_host-device[:container-device][:permissions]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#device-host-device-container-device-permissions "Link to this heading")

Add a host device to the container. The format of this is `HOST-DEVICE[:CONTAINER-DEVICE][:PERMISSIONS]`, where `HOST-DEVICE` is the path of the device node on the host, `CONTAINER-DEVICE` is the path of the device node in the container, and `PERMISSIONS` is a list of permissions combining ‘r’ for read, ‘w’ for write, and ‘m’ for mknod(2).

Example: **--device=/dev/sdc:/dev/xvdc:rwm**.

Note: if _host-device_ is a symbolic link then it is resolved first. The container only stores the major and minor numbers of the host device.

Podman may load kernel modules required for using the specified device. The devices that Podman loads modules for when necessary are: /dev/fuse.

In rootless mode, the new device is bind mounted in the container from the host rather than Podman creating it within the container space. Because the bind mount retains its SELinux label on SELinux systems, the container can get permission denied when accessing the mounted device. Modify SELinux settings to allow containers to use all device labels via the following command:

$ sudo setsebool -P container_use_devices=true

Note: if the user only has access rights via a group, accessing the device from inside a rootless container fails. Use the `--group-add keep-groups` flag to pass the user’s supplementary group access into the container.

## **--device-cgroup-rule**=_”type major:minor mode”_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#device-cgroup-rule-type-major-minor-mode "Link to this heading")

Add a rule to the cgroup allowed devices list. The rule is expected to be in the format specified in the Linux kernel documentation [admin-guide/cgroup-v1/devices](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v1/devices.html):

- _type_: `a` (all), `c` (char), or `b` (block);

- _major_ and _minor_: either a number, or `*` for all;

- _mode_: a composition of `r` (read), `w` (write), and `m` (mknod(2)).

## **--device-read-bps**=_path:rate_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#device-read-bps-path-rate "Link to this heading")

Limit read rate (in bytes per second) from a device (e.g. **--device-read-bps=/dev/sda:1mb**).

On some systems, changing the resource limits may not be allowed for non-root users. For more details, see https://github.com/containers/podman/blob/main/troubleshooting.md#26-running-containers-with-resource-limits-fails-with-a-permissions-error

This option is not supported on cgroups V1 rootless systems.

## **--device-read-iops**=_path:rate_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#device-read-iops-path-rate "Link to this heading")

Limit read rate (in IO operations per second) from a device (e.g. **--device-read-iops=/dev/sda:1000**).

On some systems, changing the resource limits may not be allowed for non-root users. For more details, see https://github.com/containers/podman/blob/main/troubleshooting.md#26-running-containers-with-resource-limits-fails-with-a-permissions-error

This option is not supported on cgroups V1 rootless systems.

## **--device-write-bps**=_path:rate_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#device-write-bps-path-rate "Link to this heading")

Limit write rate (in bytes per second) to a device (e.g. **--device-write-bps=/dev/sda:1mb**).

On some systems, changing the resource limits may not be allowed for non-root users. For more details, see https://github.com/containers/podman/blob/main/troubleshooting.md#26-running-containers-with-resource-limits-fails-with-a-permissions-error

This option is not supported on cgroups V1 rootless systems.

## **--device-write-iops**=_path:rate_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#device-write-iops-path-rate "Link to this heading")

Limit write rate (in IO operations per second) to a device (e.g. **--device-write-iops=/dev/sda:1000**).

On some systems, changing the resource limits may not be allowed for non-root users. For more details, see https://github.com/containers/podman/blob/main/troubleshooting.md#26-running-containers-with-resource-limits-fails-with-a-permissions-error

This option is not supported on cgroups V1 rootless systems.

## **--disable-content-trust**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#disable-content-trust "Link to this heading")

This is a Docker-specific option to disable image verification to a container registry and is not supported by Podman. This option is a NOOP and provided solely for scripting compatibility.

## **--dns**=_ipaddr_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#dns-ipaddr "Link to this heading")

Set custom DNS servers.

This option can be used to override the DNS configuration passed to the container. Typically this is necessary when the host DNS configuration is invalid for the container (e.g., **127.0.0.1**). When this is the case, the **--dns** flag is necessary for every run.

The special value **none** can be specified to disable creation of _/etc/resolv.conf_ in the container by Podman. The _/etc/resolv.conf_ file in the image is then used without changes.

Note that **ipaddr** may be added directly to the container’s _/etc/resolv.conf_. This is not guaranteed though. For example, passing a custom network whose _dns\_enabled_ is set to _true_ to **--network** will result in _/etc/resolv.conf_ only referring to the aardvark-dns server. aardvark-dns then forwards to the supplied **ipaddr** for all non-container name queries.

This option cannot be combined with **--network** that is set to **none** or **container:**_id_.

## **--dns-option**=_option_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#dns-option-option "Link to this heading")

Set custom DNS options. Invalid if using **--dns-option** with **--network** that is set to **none** or **container:**_id_.

## **--dns-search**=_domain_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#dns-search-domain "Link to this heading")

Set custom DNS search domains. Invalid if using **--dns-search** with **--network** that is set to **none** or **container:**_id_. Use **--dns-search=.** to remove the search domain.

## **--entrypoint**=_”command”_ | _‘[“command”, “arg1”, …]’_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#entrypoint-command-command-arg1 "Link to this heading")

Override the default ENTRYPOINT from the image.

The ENTRYPOINT of an image is similar to a COMMAND because it specifies what executable to run when the container starts, but it is (purposely) more difficult to override. The ENTRYPOINT gives a container its default nature or behavior. When the ENTRYPOINT is set, the container runs as if it were that binary, complete with default options. More options can be passed in via the COMMAND. But, if a user wants to run something else inside the container, the **--entrypoint=** option allows a new ENTRYPOINT to be specified.

Specify multi option commands in the form of a JSON string.

## **--env**, **-e**=_env_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#env-e-env "Link to this heading")

Set environment variables.

This option allows arbitrary environment variables that are available for the process to be launched inside of the container. If an environment variable is specified without a value, Podman checks the host environment for a value and set the variable only if it is set on the host. As a special case, if an environment variable ending in ***** is specified without a value, Podman searches the host environment for variables starting with the prefix and adds those variables to the container.

See [**Environment**](https://docs.podman.io/en/latest/markdown/podman-run.1.html#environment) note below for precedence and examples.

## **--env-file**=_file_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#env-file-file "Link to this heading")

Read in a line-delimited file of environment variables.

See [**Environment**](https://docs.podman.io/en/latest/markdown/podman-run.1.html#environment) note below for precedence and examples.

## **--env-host**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#env-host "Link to this heading")

Use host environment inside of the container. See **Environment** note below for precedence. (This option is not available with the remote Podman client, including Mac and Windows (excluding WSL2) machines)

## **--env-merge**=_env_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#env-merge-env "Link to this heading")

Preprocess default environment variables for the containers. For example if image contains environment variable `hello=world` user can preprocess it using `--env-merge hello=${hello}-some` so new value is `hello=world-some`.

Please note that if the environment variable `hello` is not present in the image, then it’ll be replaced by an empty string and so using `--env-merge hello=${hello}-some` would result in the new value of `hello=-some`, notice the leading `-` delimiter.

## **--expose**=_port[/protocol]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#expose-port-protocol "Link to this heading")

Expose a port or a range of ports (e.g. **--expose=3300-3310**). The protocol can be `tcp`, `udp` or `sctp` and if not given `tcp` is assumed. This option matches the EXPOSE instruction for image builds and has no effect on the actual networking rules unless **-P/--publish-all** is used to forward to all exposed ports from random host ports. To forward specific ports from the host into the container use the **-p/--publish** option instead.

## **--gidmap**=_[flags]container\_gid:from\_gid[:amount]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#gidmap-flags-container-gid-from-gid-amount "Link to this heading")

Run the container in a new user namespace using the supplied GID mapping. This option conflicts with the **--userns** and **--subgidname** options. This option provides a way to map host GIDs to container GIDs in the same way as **--uidmap** maps host UIDs to container UIDs. For details see **--uidmap**.

Note: the **--gidmap** option cannot be called in conjunction with the **--pod** option as a gidmap cannot be set on the container level when in a pod.

## **--gpus**=_ENTRY_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#gpus-entry "Link to this heading")

Start the container with GPU support. Where `ENTRY` can be `all` to request all GPUs, or a vendor-specific identifier. Currently, NVIDIA and AMD devices are supported. If both NVIDIA and AMD devices are present, the NVIDIA devices will be preferred, and a CDI device name must be specified using the `--device` flag to request a set of GPUs from a _specific_ vendor.

## **--group-add**=_group_ | _keep-groups_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#group-add-group-keep-groups "Link to this heading")

Assign additional groups to the primary user running within the container process.

- `keep-groups` is a special flag that tells Podman to keep the supplementary group access.

Allows container to use the user’s supplementary group access. If file systems or devices are only accessible by the rootless user’s group, this flag tells the OCI runtime to pass the group access into the container. Currently only available with the `crun` OCI runtime. Note: `keep-groups` is exclusive, other groups cannot be specified with this flag. (Not available for remote commands, including Mac and Windows (excluding WSL2) machines)

Note: `keep-groups` passes the supplementary groups that the _calling process_ already has into the container, it does not look the user’s groups up at container start. When Podman is started from a systemd user service, for example a rootless Quadlet, the calling process is the `systemd --user` manager, which only holds the groups the user had when that manager was started. Groups the user is added to afterwards, for example with `usermod`, are therefore not passed into the container. Restart the user’s systemd manager to pick them up, for example with `loginctl terminate-user <user>` followed by a new login, or by rebooting.

## **--group-entry**=_ENTRY_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#group-entry-entry "Link to this heading")

Customize the entry that is written to the `/etc/group` file within the container when `--user` is used.

The variables $GROUPNAME, $GID, and $USERLIST are automatically replaced with their value at runtime if present.

## **--health-cmd**=_”command”_ | _‘[“command”, “arg1”, …]’_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#health-cmd-command-command-arg1 "Link to this heading")

Set or alter a healthcheck command for a container. The command is a command to be executed inside the container that determines the container health. The command is required for other healthcheck options to be applied. A value of **none** disables existing healthchecks.

Multiple options can be passed in the form of a JSON array; otherwise, the command is interpreted as an argument to **/bin/sh -c**.

Note: The default values are used even if healthcheck is configured in the image.

## **--health-interval**=_interval_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#health-interval-interval "Link to this heading")

Set an interval for the healthchecks. An _interval_ of **disable** results in no automatic timer setup. The default is **30s**.

Note: This parameter will overwrite related healthcheck configuration from the image.

## **--health-log-destination**=_directory\_path_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#health-log-destination-directory-path "Link to this heading")

Set the destination of the HealthCheck log. Directory path, local or events_logger (local use container state file) (Default: local)

- `local`: (default) HealthCheck logs are stored in overlay containers. (For example: `$runroot/healthcheck.log`)

- `directory`: creates a log file named `<container-ID>-healthcheck.log` with HealthCheck logs in the specified directory.

- `events_logger`: The log will be written with logging mechanism set by events_logger. It also saves the log to a default directory, for performance on a system with a large number of logs.

## **--health-max-log-count**=_number of stored logs_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#health-max-log-count-number-of-stored-logs "Link to this heading")

Set maximum number of attempts in the HealthCheck log file. (‘0’ value means an infinite number of attempts in the log file) (Default: 5 attempts)

## **--health-max-log-size**=_size of stored logs_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#health-max-log-size-size-of-stored-logs "Link to this heading")

Set maximum length in characters of stored HealthCheck log. (“0” value means an infinite log length) (Default: 500 characters)

## **--health-on-failure**=_action_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#health-on-failure-action "Link to this heading")

Action to take once the container transitions to an unhealthy state. The default is **none**.

- **none**: Take no action.

- **kill**: Kill the container.

- **restart**: Restart the container. Do not combine the `restart` action with the `--restart` flag. When running inside of a systemd unit, consider using the `kill` or `stop` action instead to make use of systemd’s restart policy.

- **stop**: Stop the container.

## **--health-retries**=_retries_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#health-retries-retries "Link to this heading")

The number of retries allowed before a healthcheck is considered to be unhealthy. The default value is **3**.

Note: This parameter can overwrite the healthcheck configuration from the image.

## **--health-start-period**=_period_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#health-start-period-period "Link to this heading")

The initialization time needed for a container to bootstrap. The value can be expressed in time format like **2m3s**. The default value is **0s**.

Note: The health check command is executed as soon as a container is started, if the health check is successful the container’s health state will be updated to `healthy`. However, if the health check fails, the health state will stay as `starting` until either the health check is successful or until the `--health-start-period` time is over. If the health check command fails after the `--health-start-period` time is over, the health state will be updated to `unhealthy`. The health check command is executed periodically based on the value of `--health-interval`.

Note: This parameter will overwrite related healthcheck configuration from the image.

## **--health-startup-cmd**=_”command”_ | _‘[“command”, “arg1”, …]’_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#health-startup-cmd-command-command-arg1 "Link to this heading")

Set a startup healthcheck command for a container. This command is executed inside the container and is used to gate the regular healthcheck. When the startup command succeeds, the regular healthcheck begins and the startup healthcheck ceases. Optionally, if the command fails a set number of times, the container is restarted. A startup healthcheck can be used to ensure that containers with an extended startup period are not marked as unhealthy until they are fully started. Startup healthchecks can only be used when a regular healthcheck (from the container’s image or the `--health-cmd` option) is also set.

## **--health-startup-interval**=_interval_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#health-startup-interval-interval "Link to this heading")

Set an interval for the startup healthcheck. An _interval_ of **disable** results in no automatic timer setup. The default is **30s**.

## **--health-startup-retries**=_retries_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#health-startup-retries-retries "Link to this heading")

The number of attempts allowed before the startup healthcheck restarts the container. If set to **0**, the container is never restarted. The default is **0**.

## **--health-startup-success**=_retries_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#health-startup-success-retries "Link to this heading")

The number of successful runs required before the startup healthcheck succeeds and the regular healthcheck begins. A value of **0** means that any success begins the regular healthcheck. The default is **0**.

## **--health-startup-timeout**=_timeout_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#health-startup-timeout-timeout "Link to this heading")

The maximum time a startup healthcheck command has to complete before it is marked as failed. The value can be expressed in a time format like **2m3s**. The default value is **30s**.

## **--health-timeout**=_timeout_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#health-timeout-timeout "Link to this heading")

The maximum time allowed to complete the healthcheck before an interval is considered failed. Like start-period, the value can be expressed in a time format such as **1m22s**. The default value is **30s**.

Note: A timeout marks the healthcheck as failed. If the healthcheck command itself runs longer than the specified _timeout_, it will be sent a `SIGKILL` signal.

Note: This parameter will overwrite related healthcheck configuration from the image.

## **--help**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#help "Link to this heading")

Print usage statement

## **--hostname**, **-h**=_name_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#hostname-h-name "Link to this heading")

Set the container’s hostname inside the container.

This option can only be used with a private UTS namespace `--uts=private` (default). If `--pod` is given and the pod shares the same UTS namespace (default), the pod’s hostname is used. The given hostname is also added to the `/etc/hosts` file using the container’s primary IP address (also see the **--add-host** option).

When **--hostname** is not used and the container uses a private UTS namespace (default), Podman sets the hostname to the first 12 characters of the container ID. The container name assigned with **--name** is not used unless _container\_name\_as\_hostname=true_ is set in `containers.conf`.

Podman network DNS registers the container name, the short container ID (first 12 characters), and any explicitly set **--hostname** as DNS names. The default hostname matches the short ID alias. See **[podman-network(1)](https://docs.podman.io/en/latest/markdown/podman-network.1.html)**.

## **--hosts-file**=_path_ | _none_ | _image_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#hosts-file-path-none-image "Link to this heading")

Base file to create the `/etc/hosts` file inside the container. This must either be an absolute path to a file on the host system, or one of the following special flags: “” Follow the `base_hosts_file` configuration in _containers.conf_ (the default) `none` Do not use a base file (i.e. start with an empty file) `image` Use the container image’s `/etc/hosts` file as base file

## **--hostuser**=_name_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#hostuser-name "Link to this heading")

Add a user account to /etc/passwd from the host to the container. The Username or UID must exist on the host system.

## **--http-proxy**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#http-proxy "Link to this heading")

By default proxy environment variables are passed into the container if set for the Podman process. This can be disabled by setting the value to **false**. The environment variables passed in include **http_proxy**, **https_proxy**, **ftp_proxy**, **no_proxy**, and also the upper case versions of those. This option is only needed when the host system must use a proxy but the container does not use any proxy. Proxy environment variables specified for the container in any other way overrides the values that have been passed through from the host. (Other ways to specify the proxy for the container include passing the values with the **--env** flag, or hard coding the proxy environment at container build time.) When used with the remote client it uses the proxy environment variables that are set on the server process.

Defaults to **true**.

## **--image-volume**=**anonymous** | _tmpfs_ | _ignore_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#image-volume-anonymous-tmpfs-ignore "Link to this heading")

Tells Podman how to handle the builtin image volumes. Default is **anonymous**.

- **anonymous**: An anonymous named volume is created and mounted into the container.

- **tmpfs**: The volume is mounted onto the container as a tmpfs, which allows the users to create content that disappears when the container is stopped.

- **ignore**: All volumes are just ignored and no action is taken.

In the past, a **bind** option was accepted as well. This is deprecated, and currently aliased to **anonymous**.

## **--init**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#init "Link to this heading")

Run an init inside the container that forwards signals and reaps processes. The container-init binary is mounted at `/run/podman-init`. Mounting over `/run` breaks container execution.

## **--init-path**=_path_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#init-path-path "Link to this heading")

Path to the container-init binary.

## **--interactive**, **-i**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#interactive-i "Link to this heading")

When set to **true**, make stdin available to the contained process. If **false**, the stdin of the contained process is empty and immediately closed.

If attached, stdin is piped to the contained process. If detached, reading stdin will block until later attached.

**Caveat:** Podman will consume input from stdin as soon as it becomes available, even if the contained process doesn’t request it.

## **--ip**=_IPv4_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#ip-ipv4 "Link to this heading")

Specify a static IPv4 address for the container, for example **10.88.64.128**. This option can only be used if the container is joined to only a single network - i.e., **--network=network-name** is used at most once - and if the container is not joining another container’s network namespace via **--network=container:_id_**. The address must be within the network’s IP address pool (default **10.88.0.0/16**).

To specify multiple static IP addresses per container, use the **--network** option with multiple comma-separated `ip` values:

--network mynet:ip=10.88.0.10,ip=10.88.0.11,ip=10.88.0.12

This assigns multiple static IPv4 addresses (**10.88.0.10**, **10.88.0.11**, **10.88.0.12**) to the same network interface.

**Multi-Subnet Networks:** When a network has multiple subnets, you can assign IPs from different subnets to the same container. The IPs will be applied to a single network interface, with the first IP as primary and additional IPs as secondary addresses.

**IP Assignment Order:** For multi-subnet networks, IPs are grouped and ordered by their corresponding subnet, following the order in which subnets were defined during network creation (via `--subnet` flags). The order you specify IPs in the command does not affect the final assignment order. For example:

podman network create --subnet 10.89.0.0/24 --subnet 10.90.0.0/24 mynet
podman run --network mynet:ip=10.90.0.20,ip=10.89.0.10,ip=10.89.0.11 alpine

Results in IPs ordered by subnet: **10.89.0.10** (primary), **10.89.0.11** (secondary), **10.90.0.20** (secondary), since **10.89.0.0/24** was defined first.

**Dynamic Allocation:** If fewer IPs are specified than available subnets, the remaining subnets will receive dynamically allocated IPs. Dynamic IPs are assigned in subnet order after all static IPs are applied.

Example with multi-subnet network:

podman network create --subnet 10.89.0.0/24 --subnet 10.90.0.0/24 mynet
podman run --network mynet:ip=10.89.0.10,ip=10.90.0.20 alpine

This configures **eth0** with **10.89.0.10** (primary) and **10.90.0.20** (secondary).

## **--ip6**=_IPv6_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#ip6-ipv6 "Link to this heading")

Specify a static IPv6 address for the container, for example **fd46:db93:aa76:ac37::10**. This option can only be used if the container is joined to only a single network - i.e., **--network=network-name** is used at most once - and if the container is not joining another container’s network namespace via **--network=container:_id_**. The address must be within the network’s IPv6 address pool.

To specify multiple static IPv6 addresses per container, set multiple networks using the **--network option with a static IPv6 address specified for each using the `ip6` mode for that option.

## **--ipc**=_ipc_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#ipc-ipc "Link to this heading")

Set the IPC namespace mode for a container. The default is to create a private IPC namespace.

- “”: Use Podman’s default, defined in containers.conf.

- **container:**_id_: reuses another container’s shared memory, semaphores, and message queues

- **host**: use the host’s shared memory, semaphores, and message queues inside the container. Note: the host mode gives the container full access to local shared memory and is therefore considered insecure.

- **none**: private IPC namespace, with /dev/shm not mounted.

- **ns:**_path_: path to an IPC namespace to join.

- **private**: private IPC namespace.

- **shareable**: private IPC namespace with a possibility to share it with other containers.

## **--label**, **-l**=_key=value_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#label-l-key-value "Link to this heading")

Add metadata to a container.

## **--label-file**=_file_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#label-file-file "Link to this heading")

Read in a line-delimited file of labels.

## **--link-local-ip**=_ip_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#link-local-ip-ip "Link to this heading")

Not implemented.

## **--log-driver**=_driver_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#log-driver-driver "Link to this heading")

Logging driver for the container. Currently available options are **k8s-file**, **journald**, **none**, **passthrough** and **passthrough-tty**, with **json-file** aliased to **k8s-file** for scripting compatibility. (Default **journald**).

The podman info command below displays the default log-driver for the system.

$ podman info --format '{{ .Host.LogDriver }}'
journald

The **passthrough** driver passes down the standard streams (stdin, stdout, stderr) to the container. It is not allowed with the remote Podman client, including Mac and Windows (excluding WSL2) machines, and on a tty, since it is vulnerable to attacks via TIOCSTI.

The **passthrough-tty** driver is the same as **passthrough** except that it also allows it to be used on a TTY if the user really wants it.

## **--log-opt**=_name=value_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#log-opt-name-value "Link to this heading")

Logging driver specific options.

Set custom logging configuration. The following _name_ s are supported:

**path**: specify a path to the log file (e.g. **--log-opt path=/var/log/container/mycontainer.json**);

**max-size**: specify a max size of the log file (e.g. **--log-opt max-size=10mb**);

**tag**: specify a custom log tag for the container (e.g. **--log-opt tag=”{{.ImageName}}”**. It supports the same keys as **podman inspect --format**. This option is currently supported only by the **journald** log driver.

**label**: specify a custom log label for the container (e.g. **--log-opt label=”CONTAINER_IMAGE={{.ImageName}}”**. It supports the same keys as **podman inspect --format**. This option can be repeated multiple times. This option is currently supported only by the **journald** log driver.

## **--mac-address**=_address_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#mac-address-address "Link to this heading")

Container network interface MAC address (e.g. 92:d0:c6:0a:29:33) This option can only be used if the container is joined to only a single network - i.e., **--network=_network-name_** is used at most once - and if the container is not joining another container’s network namespace via **--network=container:_id_**.

Remember that the MAC address in an Ethernet network must be unique. The IPv6 link-local address is based on the device’s MAC address according to RFC4862.

To specify multiple static MAC addresses per container, set multiple networks using the **--network** option with a static MAC address specified for each using the `mac` mode for that option.

## **--memory**, **-m**=_number[unit]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#memory-m-number-unit "Link to this heading")

Memory limit. A _unit_ can be **b** (bytes), **k** (kibibytes), **m** (mebibytes), or **g** (gibibytes).

Allows the memory available to a container to be constrained. If the host supports swap memory, then the **--memory** memory setting can be larger than physical RAM. If a limit of 0 is specified (not using **--memory**), the container’s memory is not limited. The actual limit may be rounded up to a multiple of the operating system’s page size (the value is very large, that’s millions of trillions).

This option is not supported on cgroups V1 rootless systems.

## **--memory-reservation**=_number[unit]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#memory-reservation-number-unit "Link to this heading")

Memory soft limit. A _unit_ can be **b** (bytes), **k** (kibibytes), **m** (mebibytes), or **g** (gibibytes).

After setting memory reservation, when the system detects memory contention or low memory, containers are forced to restrict their consumption to their reservation. So always set the value below **--memory**, otherwise the hard limit takes precedence. By default, memory reservation is the same as memory limit.

This option is not supported on cgroups V1 rootless systems.

## **--memory-swap**=_number[unit]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#memory-swap-number-unit "Link to this heading")

A limit value equal to memory plus swap. A _unit_ can be **b** (bytes), **k** (kibibytes), **m** (mebibytes), or **g** (gibibytes).

Must be used with the **-m** (**--memory**) flag. The argument value must be larger than that of **-m** (**--memory**) By default, it is set to double the value of **--memory**.

Set _number_ to **-1** to enable unlimited swap.

This option is not supported on cgroups V1 rootless systems.

## **--memory-swappiness**=_number_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#memory-swappiness-number "Link to this heading")

Tune a container’s memory swappiness behavior. Accepts an integer between _0_ and _100_.

This flag is only supported on cgroups V1 rootful systems.

## **--mount**=_type=TYPE,TYPE-SPECIFIC-OPTION[,…]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#mount-type-type-type-specific-option "Link to this heading")

Attach a filesystem mount to the container.

Current supported mount TYPEs are **artifact**, **bind**, **devpts**, **glob**, **image**, **ramfs**, **tmpfs** and **volume**.

Options common to all mount types:

- _src_, _source_: mount source spec for **bind**, **glob**, and **volume**. Mandatory for **artifact**, **bind**, **glob**, and **image**. Optional for **volume**; if omitted, an anonymous volume is created.

- _dst_, _dest_, _destination_, _target_: mount destination spec.

When source globs are specified without the destination directory, the files and directories are mounted with their complete path within the container. When the destination is specified, the files and directories matching the glob on the base file name on the destination directory are mounted. The option `type=glob,src=/foo*,destination=/tmp/bar` tells container engines to mount host files matching /foo* to the /tmp/bar/ directory in the container.

Options specific to type=**artifact**:

- _digest_: If the artifact source contains multiple blobs a digest can be specified to only mount the one specific blob with the digest.

- _title_: If the artifact source contains multiple blobs a title can be set which is compared against `org.opencontainers.image.title` annotation.

- _name_: This can be used to overwrite the filename we use inside the container for mounting. On a single blob artifact the name is used as is if _dst_ is a directory and otherwise ignored. With a multi blob artifact the name will be used with an index suffix `<name>-x` where x is the layer index in the artifact starting with 0.

The _src_ argument contains the name of the artifact, which must already exist locally. The _dst_ argument contains the target path, if the path in the container is a directory the blob title (`org.opencontainers.image.title` annotation) will be used as filename and joined to the path. If the annotation does not exist the digest will be used as filename instead. This results in all blobs of the artifact mounted into the container at the given path.

However, if the _dst_ path is an existing file in the container, then the blob will be mounted directly on it. This only works when the artifact contains a single blob or when either _digest_ or _title_ are specified.

If the _dst_ path does not already exist in the container then if the artifact contains a single blob it behaves like existing file case and mounts directly to that path. If the artifact has more than one blob it works like the existing directory case and mounts each blob as file within the _dst_ path.

Options specific to type=**volume**:

- _ro_, _readonly_: _true_ or _false_ (default if unspecified: _false_).

- _U_, _chown_: _true_ or _false_ (default if unspecified: _false_). Recursively change the owner and group of the source volume based on the UID and GID of the container.

- _subpath_: Mount only a specific subpath within the volume, instead of the whole volume.

- _relabel_: _shared_, _private_. Recursively walk the mount and set the security system (e.g. SELinux) label on each file to grant access permissions from the container context. _shared_ applies a label that grants permissions to all containers, while _private_ applies a label that grants permissions to this specific container.

- _z_, _Z_: shorthand for _relabel=shared_ and _relabel=private_, respectively.

- _idmap_: If specified, create an idmapped mount to the target user namespace in the container. The idmap option is only supported by Podman in rootful mode. The Linux kernel does not allow the use of idmapped file systems for unprivileged users. The idmap option supports a custom mapping that can be different from the user namespace used by the container. The mapping can be specified after the idmap option like: `idmap=uids=0-1-10#10-11-10;gids=0-100-10`. For each triplet, the first value is the start of the backing file system IDs that are mapped to the second value on the host. The length of this mapping is given in the third value. Multiple ranges are separated with #. If the specified mapping is prepended with a ‘@’, then the mapping is considered relative to the container user namespace. The host ID for the mapping is changed to account for the relative position of the container user in the container user namespace.

Options specific to type=**image**:

- _rw_, _readwrite_: _true_ or _false_ (default if unspecified: _false_).

- _subpath_: Mount only a specific path within the image, instead of the whole image.

Options specific to **bind** and **glob**:

- _ro_, _readonly_: _true_ or _false_ (default if unspecified: _false_).

- _bind-propagation_: _shared_, _slave_, _private_, _unbindable_, _rshared_, _rslave_, _runbindable_, or **rprivate** (default).[[1]](https://docs.podman.io/en/latest/markdown/podman-run.1.html#Footnote1) See also mount(2).

- _bind-nonrecursive_: do not set up a recursive bind mount. By default it is recursive.

- _relabel_: _shared_, _private_. Recursively walk the mount and set the security system (e.g. SELinux) label on each file to grant access permissions from the container context. _shared_ applies a label that grants permissions to all containers, while _private_ applies a label that grants permissions to this specific container.

- _z_, _Z_: shorthand for _relabel=shared_ and _relabel=private_, respectively.

- _idmap_: If specified, create an idmapped mount to the target user namespace in the container. The idmap option is only supported by Podman in rootful mode. The Linux kernel does not allow the use of idmapped file systems for unprivileged users. The idmap option supports a custom mapping that can be different from the user namespace used by the container. The mapping can be specified after the idmap option like: `idmap=uids=0-1-10#10-11-10;gids=0-100-10`. For each triplet, the first value is the start of the backing file system IDs that are mapped to the second value on the host. The length of this mapping is given in the third value. Multiple ranges are separated with #. If the specified mapping is prepended with a ‘@’, then the mapping is considered relative to the container user namespace. The host ID for the mapping is changed to account for the relative position of the container user in the container user namespace.

- _U_, _chown_: _true_ or _false_ (default if unspecified: _false_). Recursively change the owner and group of the source volume based on the UID and GID of the container.

- _no-dereference_: do not dereference symlinks but copy the link source into the mount destination.

Options specific to type=**tmpfs** and **ramfs**:

- _ro_, _readonly_: _true_ or _false_ (default if unspecified: _false_).

- _tmpfs-size_: Size of the tmpfs/ramfs mount, in bytes. Unlimited by default in Linux.

- _tmpfs-mode_: Octal file mode of the tmpfs/ramfs (e.g. 700 or 0700.).

- _tmpcopyup_: Enable copyup from the image directory at the same location to the tmpfs/ramfs. Used by default.

When the tmpfs destination is inside a volume or bind mount, files from the parent mount are also copied into the tmpfs, so the parent content remains visible. Use **notmpcopyup** to mount an empty tmpfs that shadows the parent mount’s subtree.

- _noatime_: Disable updating file access times when the file is read.

- _notmpcopyup_: Disable copying files from the image to the tmpfs/ramfs.

Use this option when mounting a tmpfs inside a volume or bind mount to ensure the tmpfs properly shadows the parent mount’s subtree.

- _U_, _chown_: _true_ or _false_ (default if unspecified: _false_). Set the uid and gid options for the tmpfs filesystem based on the UID and GID of the container. This is **not** recursive.

Options specific to type=**devpts**:

- _uid_: numeric UID of the file owner (default: 0).

- _gid_: numeric GID of the file owner (default: 0).

- _mode_: octal permission mask for the file (default: 600).

- _max_: maximum number of PTYs (default: 1048576).

Examples:

- `type=bind,source=/path/on/host,destination=/path/in/container`

- `type=bind,src=/path/on/host,dst=/path/in/container,relabel=shared`

- `type=bind,src=/path/on/host,dst=/path/in/container,relabel=shared,U=true`

- `type=bind,src=/path/on/host,dst=/path/in/container,idmap`

- `type=bind,src=/path/on/host,dst=/path/in/container,idmap=uids=0-1-10;gids=0-100-10`

- `type=devpts,destination=/dev/pts`

- `type=glob,src=/usr/lib/libfoo*,destination=/usr/lib,ro=true`

- `type=image,source=fedora,destination=/fedora-image,rw=true`

- `type=ramfs,tmpfs-size=512M,destination=/path/in/container`

- `type=tmpfs,tmpfs-size=512M,destination=/path/in/container`

- `type=tmpfs,destination=/path/in/container,noswap`

- `type=artifact,src=quay.io/libpod/testartifact:20250206-single,dst=/data`

- `type=artifact,src=quay.io/libpod/testartifact:20250206-multi,dst=/data,title=test1`

- `type=volume,destination=/path/in/container`

- `type=volume,src=test_vol,dst=/data,subpath=/code/docs`

## **--name**=_name_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#name-name "Link to this heading")

Assign a name to the container.

The operator can identify a container in three ways:

- UUID long identifier (“f78375b1c487e03c9438c729345e54db9d20cfa2ac1fc3494b6eb60872e74778”);

- UUID short identifier (“f78375b1c487”);

- Name (“jonah”).

Podman generates a UUID for each container, and if no name is assigned to the container using **--name**, Podman generates a random string name such as `exciting_chebyshev` (`adjective_noun`, compatible with Docker). Container names are not required to be valid hostnames or domain names. Underscores and other characters allowed by naming rules are permitted. On Podman networks with DNS enabled, container-to-container name resolution still uses the name as given, for example `exciting_chebyshev`. The name can be useful as a more human-friendly way to identify containers. This works for both background and foreground containers. The container’s name is also added to the `/etc/hosts` file using the container’s primary IP address (also see the **--add-host** option).

The name is not the hostname inside the container; see **--hostname**. See **[podman-network(1)](https://docs.podman.io/en/latest/markdown/podman-network.1.html)** for more on network DNS.

## **--network**=_mode_, **--net**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#network-mode-net "Link to this heading")

Set the network mode for the container.

Valid _mode_ values are:

- **bridge[:OPTIONS,…]**: Create a network stack on the default bridge. This is the default for rootful containers. It is possible to specify these additional options:

  - **alias=**_name_: Add network-scoped alias for the container.

  - **ip=**_IPv4_: Specify a static IPv4 address for this container.

  - **ip6=**_IPv6_: Specify a static IPv6 address for this container.

  - **mac=**_MAC_: Specify a static MAC address for this container.

  - **interface_name=**_name_: Specify a name for the created network interface inside the container.

  - **host_interface_name=**_name_: Specify a name for the created network interface outside the container.

Any other options will be passed through to netavark without validation. This can be useful to pass arguments to netavark plugins.

For rootless bridge networks, port forwarding uses `rootlessport` by default. Setting `rootless_port_forwarder="pasta"` in the `[network]` section of **[containers.conf(5)](https://github.com/containers/container-libs/blob/main/common/docs/containers.conf.5.md)** switches to pasta’s kernel-level forwarding (via `pesto`), which preserves the original client source IP address inside the container. This option is experimental and its behavior is subject to change.

For example, to set a static IPv4 address and a static mac address, use `--network bridge:ip=10.88.0.10,mac=44:33:22:11:00:99`.

- _<network name or ID>_**[:OPTIONS,…]**: Connect to a user-defined network; this is the network name or ID from a network created by **[podman network create](https://docs.podman.io/en/latest/markdown/podman-network-create.1.html)**. It is possible to specify the same options described under the bridge mode above. Use the **--network** option multiple times to specify additional networks.

For backwards compatibility it is also possible to specify comma-separated networks on the first **--network** argument, however this prevents you from using the options described under the bridge section above.

- **none**: Create a network namespace for the container but do not configure network interfaces for it, thus the container has no network connectivity.

- **container:**_id_: Reuse another container’s network stack.

- **host**: Use the host’s network namespace for the container instead of creating an isolated namespace. Warning: This gives the container full access to abstract Unix domain sockets and to TCP/UDP sockets bound to localhost. Since these mechanisms are often used to prevent access to sensitive system services, isolating them from access by external entities, use of this option may be considered a security vulnerability.

- **ns:**_path_: Path to a network namespace to join.

- **private**: Create a new namespace for the container. This uses the **bridge** mode for rootful containers and **pasta** for rootless ones.

- **pasta[:OPTIONS,…]**: use **pasta**(1) to create a user-mode networking stack.

This is the default for rootless containers and only supported in rootless mode.

By default, IPv4 and IPv6 addresses and routes, as well as the pod interface name, are copied from the host. Port forwarding preserves the original source IP address. Options described in pasta(1) can be specified as comma-separated arguments.

In terms of pasta(1) options, **--config-net** is given by default, in order to configure networking when the container is started, and **--no-map-gw** is also assumed by default, to avoid direct access from container to host using the gateway address. The latter can be overridden by passing **--map-gw** in the pasta-specific options (despite not being an actual pasta(1) option).

For better integration with DNS handling, **--dns-forward 169.254.1.1** is passed by default, and this address is added to resolv.conf(5) as first resolver. It is possible to pass **--dns-forward** explicitly in case a different IP address should be used.

To make the `host.containers.internal` /etc/hosts entry work and allow connections to the host, **--map-guest-addr 169.254.1.2** is passed by default. Again, it can be set explicitly to choose a different IP address.

Also, **-t none** and **-u none** are passed if, respectively, no TCP or UDP port forwarding from host to container is configured (via Podman’s **--publish** or by passing the pasta **-t**/**-u** options directly), to disable automatic port forwarding based on bound ports. Similarly, **-T none** and **-U none** are given to disable the same functionality from container to host.

All options can also be set in **[containers.conf(5)](https://github.com/containers/container-libs/blob/main/common/docs/containers.conf.5.md)**; see the `pasta_options` key under the network section in that file.

Some examples:

    *   **pasta:--map-gw**: Allow the container to directly reach the host using the gateway address.

    *   **pasta:--mtu,1500**: Specify a 1500 bytes MTU for the _tap_ interface in the container.

    *   **pasta:--ipv4-only,-a,10.0.2.0,-n,24,-g,10.0.2.2,--dns-forward,10.0.2.3,-m,1500,--no-ndp,--no-dhcpv6,--no-dhcp**: disable IPv6, assign `10.0.2.0/24` to the `tap0` interface in the container, with gateway `10.0.2.3`, enable DNS forwarder reachable at `10.0.2.3`, set MTU to 1500 bytes, disable NDP, DHCPv6 and DHCP support.

    *   **pasta:-I,tap0,--ipv4-only,-a,10.0.2.0,-n,24,-g,10.0.2.2,--dns-forward,10.0.2.3,--no-ndp,--no-dhcpv6,--no-dhcp**: same as above, but leave the MTU to 65520 bytes

    *   **pasta:-t,auto,-u,auto,-T,auto,-U,auto**: enable automatic port forwarding based on observed bound ports from both host and container sides

    *   **pasta:-T,5201**: enable forwarding of TCP port 5201 from container to host, using the loopback interface instead of the tap interface for improved performance

Invalid if using **--dns**, **--dns-option**, or **--dns-search** with **--network** set to **none** or **container:**_id_.

If used together with **--pod**, the container joins the pod’s network namespace.

## **--network-alias**=_alias_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#network-alias-alias "Link to this heading")

Add a network-scoped alias for the container, setting the alias for all networks that the container joins. To set a name only for a specific network, use the alias option as described under the **--network** option. If the network has DNS enabled (`podman network inspect -f {{.DNSEnabled}} <name>`), these aliases can be used for name resolution on the given network. This option can be specified multiple times.

## **--no-healthcheck**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#no-healthcheck "Link to this heading")

Disable any defined healthchecks for container.

## **--no-hostname**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#no-hostname "Link to this heading")

Do not create the _/etc/hostname_ file in the containers.

By default, Podman manages the _/etc/hostname_ file, adding the container’s own hostname. When the **--no-hostname** option is set, the image’s _/etc/hostname_ will be preserved unmodified if it exists.

## **--no-hosts**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#no-hosts "Link to this heading")

Do not modify the `/etc/hosts` file in the container.

Podman assumes control over the container’s `/etc/hosts` file by default and adds entries for the container’s name (see **--name** option) and hostname (see **--hostname** option), the internal `host.containers.internal` and `host.docker.internal` hosts, as well as any hostname added using the **--add-host** option. Refer to the **--add-host** option for details. Passing **--no-hosts** disables this, so that the image’s `/etc/hosts` file is kept unmodified. The same can be achieved globally by setting _no\_hosts=true_ in `containers.conf`.

This option conflicts with **--add-host**.

## **--oom-kill-disable**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#oom-kill-disable "Link to this heading")

Whether to disable OOM Killer for the container or not.

This flag is not supported on cgroups V2 systems.

## **--oom-score-adj**=_num_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#oom-score-adj-num "Link to this heading")

Tune the host’s OOM preferences for containers (accepts values from **-1000** to **1000**).

When running in rootless mode, the specified value can’t be lower than the oom_score_adj for the current process. In this case, the oom-score-adj is clamped to the current process value.

## **--os**=_OS_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#os-os "Link to this heading")

Override the OS, defaults to the host, of the image to be pulled. For example, `windows`. Unless overridden, subsequent lookups of the same image in the local storage matches this OS, regardless of the host.

## **--passwd**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#passwd "Link to this heading")

Allow Podman to add entries to /etc/passwd and /etc/group when used in conjunction with the --user option. This is used to override the Podman provided user setup in favor of entrypoint configurations such as libnss-extrausers.

## **--passwd-entry**=_ENTRY_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#passwd-entry-entry "Link to this heading")

Customize the entry that is written to the `/etc/passwd` file within the container when `--passwd` is used.

The variables $USERNAME, $UID, $GID, $NAME, $HOME are automatically replaced with their value at runtime.

## **--personality**=_persona_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#personality-persona "Link to this heading")

Personality sets the execution domain via Linux personality(2).

## **--pid**=_mode_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#pid-mode "Link to this heading")

Set the PID namespace mode for the container. The default is to create a private PID namespace for the container.

- **container:**_id_: join another container’s PID namespace;

- **host**: use the host’s PID namespace for the container. Note the host mode gives the container full access to local PID and is therefore considered insecure;

- **ns:**_path_: join the specified PID namespace;

- **private**: create a new namespace for the container (default).

## **--pidfile**=_path_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#pidfile-path "Link to this heading")

When the pidfile location is specified, the container process’ PID is written to the pidfile. (This option is not available with the remote Podman client, including Mac and Windows (excluding WSL2) machines) If the pidfile option is not specified, the container process’ PID is written to /run/containers/storage/${storage-driver}-containers/$CID/userdata/pidfile.

After the container is started, the location for the pidfile can be discovered with the following `podman inspect` command:

$ podman inspect --format '{{ .PidFile }}' $CID
/run/containers/storage/${storage-driver}-containers/$CID/userdata/pidfile

## **--pids-limit**=_limit_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#pids-limit-limit "Link to this heading")

Tune the container’s pids limit. Set to **-1** to have unlimited pids for the container. The default is **2048** on systems that support “pids” cgroup controller.

## **--platform**=_OS/ARCH_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#platform-os-arch "Link to this heading")

Specify the platform for selecting the image. (Conflicts with --arch and --os) The `--platform` option can be used to override the current architecture and operating system. Unless overridden, subsequent lookups of the same image in the local storage matches this platform, regardless of the host.

## **--pod**=_name_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#pod-name "Link to this heading")

Run container in an existing pod. Podman makes the pod automatically if the pod name is prefixed with **new:**. To make a pod with more granular options, use the **podman pod create** command before creating a container. When a container is run with a pod with an infra-container, the infra-container is started first.

## **--pod-id-file**=_file_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#pod-id-file-file "Link to this heading")

Run container in an existing pod and read the pod’s ID from the specified _file_. When a container is run within a pod which has an infra-container, the infra-container starts first.

## **--preserve-fd**=_FD1[,FD2,…]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#preserve-fd-fd1-fd2 "Link to this heading")

Pass down to the process the additional file descriptors specified in the comma separated list. It can be specified multiple times. This option is only supported with the crun OCI runtime. It might be a security risk to use this option with other OCI runtimes.

(This option is not available with the remote Podman client, including Mac and Windows (excluding WSL2) machines)

## **--preserve-fds**=_N_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#preserve-fds-n "Link to this heading")

Pass down to the process N additional file descriptors (in addition to 0, 1, 2). The total FDs are 3+N. (This option is not available with the remote Podman client, including Mac and Windows (excluding WSL2) machines)

## **--privileged**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#privileged "Link to this heading")

Give extended privileges to this container. The default is **false**.

By default, Podman containers are unprivileged (**=false**) and cannot, for example, modify parts of the operating system. This is because by default a container is only allowed limited access to devices. A “privileged” container is given the same access to devices as the user launching the container, with the exception of virtual consoles (_/dev/tty\d+_) when running in systemd mode (**--systemd=always**).

A privileged container turns off the security features that isolate the container from the host. Dropped Capabilities, limited devices, read-only mount points, Apparmor/SELinux separation, and Seccomp filters are all disabled. Due to the disabled security features, the privileged field should almost never be set as containers can easily break out of confinement.

Containers running in a user namespace (e.g., rootless containers) cannot have more privileges than the user that launched them.

## **--publish**, **-p**=_[[hostIP:][hostPort]:]containerPort[/protocol]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#publish-p-hostip-hostport-containerport-protocol "Link to this heading")

Publish a container’s port, or range of ports, to the host.

Both _hostPort_ and _containerPort_ can be specified as a range of ports. When specifying ranges for both, the number of container ports in the range must match the number of host ports in the range.

If _hostIP_ is `0.0.0.0`, only IPv4 addresses will be bound, if set to `[::]` only IPv6 addresses are bound. In all other cases the exact IP address as given will be bound. If _hostIP_ is not set at all, the port is bound on all IP addresses on the host, both v4 and v6 (if possible).

The default _hostIP_ can be configured in **[containers.conf(5)](https://github.com/containers/container-libs/blob/main/common/docs/containers.conf.5.md)** using the `default_host_ips` option under the `[network]` section. This option accepts an array to be able to set multiple bind IP addresses. For example setting `default_host_ips = ["127.0.0.1", "::1"]` will make the port be published on the ipv4 and ipv6 localhost address respectively. An explicit _hostIP_ set on the command will always override the config option.

By default, Podman publishes TCP ports. To publish a UDP port instead, give `udp` as protocol. To publish both TCP and UDP ports, set `--publish` twice, with `tcp`, and `udp` as protocols respectively. Rootful containers can also publish ports using the `sctp` protocol.

Host port does not have to be specified (e.g. `podman run -p 127.0.0.1::80`). If it is not, the container port is randomly assigned a port on the host.

Use **podman port** to see the actual mapping: `podman port $CONTAINER $CONTAINERPORT`.

Port publishing is only supported for containers utilizing their own network namespace through `bridge` networks, or the `pasta` network mode.

For rootless bridge networks, port forwarding uses `rootlessport` by default, which is a userspace proxy that does not preserve client source IPs. Setting `rootless_port_forwarder="pasta"` in the `[network]` section of **[containers.conf(5)](https://github.com/containers/container-libs/blob/main/common/docs/containers.conf.5.md)** switches to pasta’s kernel-level forwarding via `pesto`, preserving the original client IP address inside the container. This option is experimental and its behavior is subject to change.

**Note:** If a container runs within a pod, it is not necessary to publish the port for the containers in the pod. The port must only be published by the pod itself. Pod network stacks act like the network stack on the host - meaning a variety of containers in the pod and programs in the container all share a single interface, IP address, and associated ports. If one container binds to a port, no other container can use that port within the pod while it is in use. Containers in the pod can also communicate over localhost by having one container bind to localhost in the pod, and another connect to that port.

## **--publish-all**, **-P**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#publish-all-p "Link to this heading")

Publish all exposed ports to random ports on the host interfaces. The default is **false**.

When set to **true**, publish all exposed ports to the host interfaces. If the operator uses **-P** (or **-p**) then Podman makes the exposed port accessible on the host and the ports are available to any client that can reach the host.

When using this option, Podman binds any exposed port to a random port on the host within an ephemeral port range defined by _/proc/sys/net/ipv4/ip\_local\_port\_range_. To find the mapping between the host ports and the exposed ports, use **podman port**.

## **--pull**=_policy_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#pull-policy "Link to this heading")

Pull image policy. The default is **missing**.

- **always**: Always pull the image and throw an error if the pull fails.

- **missing**: Pull the image only when the image is not in the local containers storage. Throw an error if no image is found and the pull fails.

- **never**: Never pull the image but use the one from the local containers storage. Throw an error if no image is found.

- **newer**: Pull if the image on the registry is newer than the one in the local containers storage. An image is considered to be newer when the digests are different. Comparing the time stamps is prone to errors. Pull errors are suppressed if a local image was found.

## **--quiet**, **-q**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#quiet-q "Link to this heading")

Suppress output information when pulling images

## **--rdt-class**=_intel-rdt-class-of-service_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#rdt-class-intel-rdt-class-of-service "Link to this heading")

Rdt-class sets the class of service (CLOS or COS) for the container to run in. Based on the Cache Allocation Technology (CAT) feature that is part of Intel’s Resource Director Technology (RDT) feature set, all container processes will run within the pre-configured COS, representing a part of the cache. The COS has to be created and configured using a pseudo file system (usually mounted at `/sys/fs/resctrl`) that the resctrl kernel driver provides. Assigning the container to a COS requires root privileges and thus doesn’t work in a rootless environment. Currently, the feature is only supported using `runc` as a runtime. See [https://docs.kernel.org/arch/x86/resctrl.html](https://docs.kernel.org/arch/x86/resctrl.html) for more details on creating a COS before a container can be assigned to it.

## **--read-only**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#read-only "Link to this heading")

Mount the container’s root filesystem as read-only.

By default, container root filesystems are writable, allowing processes to write files anywhere. By specifying the **--read-only** flag, the container’s root filesystem is mounted read-only prohibiting any writes.

## **--read-only-tmpfs**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#read-only-tmpfs "Link to this heading")

When running --read-only containers, mount a read-write tmpfs on _/dev_, _/dev/shm_, _/run_, _/tmp_, and _/var/tmp_. The default is **true**.

| --read-only | --read-only-tmpfs | /   | /run, /tmp, /var/tmp |
| ----------- | ----------------- | --- | -------------------- |
| true        | true              | r/o | r/w                  |
| true        | false             | r/o | r/o                  |
| false       | false             | r/w | r/w                  |
| false       | true              | r/w | r/w                  |

When **--read-only=true** and **--read-only-tmpfs=true** additional tmpfs are mounted on the /tmp, /run, and /var/tmp directories.

When **--read-only=true** and **--read-only-tmpfs=false** /dev and /dev/shm are marked Read/Only and no tmpfs are mounted on /tmp, /run and /var/tmp. The directories are exposed from the underlying image, meaning they are read-only by default. This makes the container totally read-only. No writable directories exist within the container. In this mode writable directories need to be added via external volumes or mounts.

By default, when **--read-only=false** , the /dev and /dev/shm are read/write, and the /tmp, /run, and /var/tmp are read/write directories from the container image.

## **--replace**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#replace "Link to this heading")

If another container with the same name already exists, replace and remove it. The default is **false**.

## **--requires**=_container_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#requires-container "Link to this heading")

Specify one or more requirements. A requirement is a dependency container that is started before this container. Containers can be specified by name or ID, with multiple containers being separated by commas.

## **--restart**=_policy_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#restart-policy "Link to this heading")

Restart policy to follow when containers exit. Restart policy does not take effect if a container is stopped via the **podman kill** or **podman stop** commands.

Valid _policy_ values are:

- `no` : Do not restart containers on exit

- `never` : Synonym for **no**; do not restart containers on exit

- `on-failure[:max_retries]` : Restart containers when they exit with a non-zero exit code, retrying indefinitely or until the optional _max\_retries_ count is hit

- `always` : Restart containers when they exit, regardless of status, retrying indefinitely

- `unless-stopped` : Restart containers when they exit, unless the container was explicitly stopped by the user. After a system reboot, containers with this policy will be restarted by podman-restart.service only if they were not explicitly stopped by the user before the reboot. This differs from **always**, which restarts containers after a system reboot regardless of whether they were user-stopped

Podman provides a systemd unit file, podman-restart.service, which restarts containers after a system reboot.

When running containers in systemd services, use the restart functionality provided by systemd. In other words, do not use this option in a container unit, instead set the `Restart=` systemd directive in the `[Service]` section. See **podman-systemd.unit**(5) and **systemd.service**(5).

## **--retry**=_attempts_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#retry-attempts "Link to this heading")

Number of times to retry pulling or pushing images between the registry and local storage in case of failure. Default is **3**.

## **--retry-delay**=_duration_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#retry-delay-duration "Link to this heading")

Duration of delay between retry attempts when pulling or pushing images between the registry and local storage in case of failure. The default is to start at two seconds and then exponentially back off. The delay is used when this value is set, and no exponential back off occurs.

## **--rm**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#rm "Link to this heading")

Automatically remove the container and any anonymous unnamed volume associated with the container when it exits. The default is **false**.

## **--rmi**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#rmi "Link to this heading")

After exit of the container, remove the image unless another container is using it. Implies --rm on the new container. The default is _false_.

## **--rootfs**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#rootfs "Link to this heading")

If specified, the first argument refers to an exploded container on the file system.

This is useful to run a container without requiring any image management, the rootfs of the container is assumed to be managed externally.

`Overlay Rootfs Mounts`

The `:O` flag tells Podman to mount the directory from the rootfs path as storage using the `overlay file system`. The container processes can modify content within the mount point which is stored in the container storage in a separate directory. In overlay terms, the source directory is the lower, and the container storage directory is the upper. Modifications to the mount point are destroyed when the container finishes executing, similar to a tmpfs mount point being unmounted.

Note: On **SELinux** systems, the rootfs needs the correct label, which is by default **unconfined_u:object_r:container_file_t:s0**.

`idmap`

If `idmap` is specified, create an idmapped mount to the target user namespace in the container. The idmap option supports a custom mapping that can be different than the user namespace used by the container. The mapping can be specified after the idmap option like: `idmap=uids=0-1-10#10-11-10;gids=0-100-10`. For each triplet, the first value is the start of the backing file system IDs that are mapped to the second value on the host. The length of this mapping is given in the third value. Multiple ranges are separated with #.

## **--sdnotify**=**container** | _conmon_ | _healthy_ | _ignore_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#sdnotify-container-conmon-healthy-ignore "Link to this heading")

Determines how to use the NOTIFY_SOCKET, as passed with systemd and Type=notify.

Default is **container**, which means allow the OCI runtime to proxy the socket into the container to receive ready notification. Podman sets the MAINPID to conmon’s pid. The **conmon** option sets MAINPID to conmon’s pid, and sends READY when the container has started. The socket is never passed to the runtime or the container. The **healthy** option sets MAINPID to conmon’s pid, and sends READY when the container has turned healthy; requires a healthcheck to be set. The socket is never passed to the runtime or the container. The **ignore** option removes NOTIFY_SOCKET from the environment for itself and child processes, for the case where some other process above Podman uses NOTIFY_SOCKET and Podman does not use it.

## **--seccomp-policy**=_policy_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#seccomp-policy-policy "Link to this heading")

Specify the policy to select the seccomp profile. If set to _image_, Podman looks for a “io.containers.seccomp.profile” label in the container-image config and use its value as a seccomp profile. Otherwise, Podman follows the _default_ policy by applying the default profile unless specified otherwise via _--security-opt seccomp_ as described below.

Note that this feature is experimental and may change in the future.

## **--secret**=_secret[,opt=opt …]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#secret-secret-opt-opt "Link to this heading")

Give the container access to a secret. Can be specified multiple times.

A secret is a blob of sensitive data which a container needs at runtime but is not stored in the image or in source control, such as usernames and passwords, TLS certificates and keys, SSH keys or other important generic strings or binary content (up to 512 kB in size).

When secrets are specified as type `mount`, the secrets are copied and mounted into the container when a container is created. When secrets are specified as type `env`, the secret is set as an environment variable within the container. Secrets are written in the container at the time of container creation, and modifying the secret using `podman secret` commands after the container is created affects the secret inside the container.

Secrets and its storage are managed using the `podman secret` command.

Secret Options

- `type=mount|env` : How the secret is exposed to the container. `mount` mounts the secret into the container as a file. `env` exposes the secret as an environment variable. Defaults to `mount`.

- `target=target` : Target of secret. For mounted secrets, this is the path to the secret inside the container. If a fully qualified path is provided, the secret is mounted at that location. Otherwise, the secret is mounted to `/run/secrets/target` for Linux containers or `/var/run/secrets/target` for FreeBSD containers. If the target is not set, the secret is mounted to `/run/secrets/secretname` by default. For env secrets, this is the environment variable key. Defaults to `secretname`.

- `uid=0` : UID of secret. Defaults to 0. Mount secret type only.

- `gid=0` : GID of secret. Defaults to 0. Mount secret type only.

- `mode=0` : Mode of secret. Defaults to 0444. Mount secret type only.

Examples

Mount at `/my/location/mysecret` with UID 1:

--secret mysecret,target=/my/location/mysecret,uid=1

Mount at `/run/secrets/customtarget` with mode 0777:

--secret mysecret,target=customtarget,mode=0777

Create a secret environment variable called `ENVSEC`:

--secret mysecret,type=env,target=ENVSEC

## **--security-opt**=_option_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#security-opt-option "Link to this heading")

Security Options

- **apparmor=unconfined** : Turn off apparmor confinement for the container

- **apparmor**=_alternate-profile_ : Set the apparmor confinement profile for the container

- **label=user:**_USER_: Set the label user for the container processes

- **label=role:**_ROLE_: Set the label role for the container processes

- **label=type:**_TYPE_: Set the label process type for the container processes

- **label=level:**_LEVEL_: Set the label level for the container processes

- **label=filetype:**_TYPE_: Set the label file type for the container files

- **label=disable**: Turn off label separation for the container

Note: Labeling can be disabled for all containers by setting label=false in the **containers.conf** (`/etc/containers/containers.conf` or `$HOME/.config/containers/containers.conf`) file.

- **label=nested**: Allows SELinux modifications within the container. Containers are allowed to modify SELinux labels on files and processes, as long as SELinux policy allows. Without **nested**, containers view SELinux as disabled, even when it is enabled on the host. Containers are prevented from setting any labels.

- **mask**=_/path/1:/path/2_: The paths to mask separated by a colon. A masked path cannot be accessed inside the container.

- **no-new-privileges**: Disable container processes from gaining additional privileges through the `execve(2)` system call (e.g. via setuid or setgid bits, or via file capabilities). Programs that rely on setuid/setgid bits set on their executable to change user id or group id are no longer able to do so, and any file capabilities added to the executable (e.g. via `setcap`) are not added to the permitted capability set. For more details, see: https://docs.kernel.org/userspace-api/no_new_privs.html.

- **seccomp=unconfined**: Turn off seccomp confinement for the container.

- **seccomp=profile.json**: JSON file to be used as a seccomp filter. Note that the `io.podman.annotations.seccomp` annotation is set with the specified value as shown in `podman inspect`.

- **proc-opts**=_OPTIONS_ : Comma-separated list of options to use for the /proc mount. More details for the possible mount options are specified in the **proc(5)** man page.

- **unmask**=_ALL_ or _/path/1:/path/2_, or shell expanded paths (/proc/*): Paths to unmask separated by a colon. If set to **ALL**, it unmasks all the paths that are masked or made read-only by default. The default masked paths are **/proc/acpi, /proc/kcore, /proc/keys, /proc/latency_stats, /proc/sched_debug, /proc/scsi, /proc/timer_list, /proc/timer_stats, /sys/firmware, and /sys/fs/selinux**, **/sys/devices/virtual/powercap**. The default paths that are read-only are **/proc/asound**, **/proc/bus**, **/proc/fs**, **/proc/irq**, **/proc/sys**, **/proc/sysrq-trigger**, **/sys/fs/cgroup**.

Note: Labeling can be disabled for all containers by setting **label=false** in the **containers.conf**(5) file.

## **--shm-size**=_number[unit]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#shm-size-number-unit "Link to this heading")

Size of _/dev/shm_. A _unit_ can be **b** (bytes), **k** (kibibytes), **m** (mebibytes), or **g** (gibibytes). If the unit is omitted, the system uses bytes. If the size is omitted, the default is **64m**. When _size_ is **0**, there is no limit on the amount of memory used for IPC by the container. This option conflicts with **--ipc=host**.

## **--shm-size-systemd**=_number[unit]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#shm-size-systemd-number-unit "Link to this heading")

Size of systemd-specific tmpfs mounts such as /run, /run/lock, /var/log/journal and /tmp. A _unit_ can be **b** (bytes), **k** (kibibytes), **m** (mebibytes), or **g** (gibibytes). If the unit is omitted, the system uses bytes. If the size is omitted, the default is **64m**. When _size_ is **0**, the usage is limited to 50% of the host’s available memory.

## **--sig-proxy**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#sig-proxy "Link to this heading")

Proxy received signals to the container process. SIGCHLD, SIGURG, SIGSTOP, and SIGKILL are not proxied.

The default is **true**.

## **--stop-signal**=_signal_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#stop-signal-signal "Link to this heading")

Signal to stop a container. Default is **SIGTERM**.

## **--stop-timeout**=_seconds_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#stop-timeout-seconds "Link to this heading")

Timeout to stop a container. Default is **10**. Remote connections use local containers.conf for defaults.

## **--subgidname**=_name_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#subgidname-name "Link to this heading")

Run the container in a new user namespace using the map with _name_ in the _/etc/subgid_ file. When running rootless, the user needs the necessary permissions to use the mapping. See **subgid**(5). This flag conflicts with **--userns** and **--gidmap**. Together with **--gidmap** it acts as if **--gidmap** was passed with all mappings of the _name_ group in _/etc/subgid_.

## **--subuidname**=_name_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#subuidname-name "Link to this heading")

Run the container in a new user namespace using the map with _name_ in the _/etc/subuid_ file. When running rootless, the user needs the necessary permissions to use the mapping. See **subuid**(5). This flag conflicts with **--userns** and **--uidmap**. Together with **--uidmap** it acts as if **--uidmap** was passed with all mappings of the _name_ user in _/etc/subuid_.

## **--sysctl**=_name=value_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#sysctl-name-value "Link to this heading")

Configure namespaced kernel parameters at runtime.

For the IPC namespace, the following sysctls are allowed:

- kernel.msgmax

- kernel.msgmnb

- kernel.msgmni

- kernel.sem

- kernel.shmall

- kernel.shmmax

- kernel.shmmni

- kernel.shm_rmid_forced

- Sysctls beginning with fs.mqueue.*

Note: if using the **--ipc=host** option, the above sysctls are not allowed.

For the network namespace, only sysctls beginning with net.* are allowed.

Note: if using the **--network=host** option, the above sysctls are not allowed.

## **--systemd**=_true_ | _false_ | _always_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#systemd-true-false-always "Link to this heading")

Run container in systemd mode. The default is **true**.

- **true** enables systemd mode only when the command executed inside the container is _systemd_, _/usr/sbin/init_, _/sbin/init_ or _/usr/local/sbin/init_.

- **false** disables systemd mode.

- **always** enforces the systemd mode to be enabled.

Running the container in systemd mode causes the following changes:

- Podman mounts tmpfs file systems on the following directories

  - _/run_

  - _/run/lock_

  - _/tmp_

  - _/sys/fs/cgroup/systemd_ (on a cgroup v1 system)

  - _/var/lib/journal_

- Podman sets the default stop signal to **SIGRTMIN+3**.

- Podman sets **container_uuid** environment variable in the container to the first 32 characters of the container ID.

- Podman does not mount virtual consoles (_/dev/tty\d+_) when running with **--privileged**.

- On cgroup v2, _/sys/fs/cgroup_ is mounted writable.

This allows systemd to run in a confined container without any modifications.

Note that on **SELinux** systems, systemd attempts to write to the cgroup file system. Containers writing to the cgroup file system are denied by default. The **container_manage_cgroup** boolean must be enabled for this to be allowed on an SELinux separated system.

setsebool -P container_manage_cgroup true

## **--timeout**=_seconds_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#timeout-seconds "Link to this heading")

Maximum time a container is allowed to run before conmon sends it the kill signal. By default containers run until they exit or are stopped by `podman stop`.

## **--tls-verify**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#tls-verify "Link to this heading")

Require HTTPS and verify certificates when contacting registries (default: **true**). If explicitly set to **true**, TLS verification is used. If set to **false**, TLS verification is not used. If not specified, TLS verification is used unless the target registry is listed as an insecure registry in **[containers-registries.conf(5)](https://github.com/containers/image/blob/main/docs/containers-registries.conf.5.md)**

## **--tmpfs**=_fs_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#tmpfs-fs "Link to this heading")

Create a tmpfs mount.

Mount a temporary filesystem (**tmpfs**) mount into a container, for example:

$ podman run -d --tmpfs /tmp:rw,size=787448k,mode=1777 my_image

This command mounts a **tmpfs** at _/tmp_ within the container. The supported mount options are the same as the Linux default mount flags. If no options are specified, the system uses the following options: **rw,noexec,nosuid,nodev**.

By default, Podman enables **tmpcopyup** on tmpfs mounts, which copies the contents of the underlying image directory into the tmpfs before mounting it. This also applies when the tmpfs destination is inside a volume or bind mount: files from the parent mount are copied into the tmpfs, so the parent content remains visible. To mount an empty tmpfs that shadows a parent mount’s subtree, use the **notmpcopyup** option:

$ podman run --volume myvolume:/data --tmpfs /data/sub:notmpcopyup my_image

## **--tty**, **-t**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#tty-t "Link to this heading")

Allocate a pseudo-TTY. The default is **false**.

When set to **true**, Podman allocates a pseudo-tty and attach to the standard input of the container. This can be used, for example, to run a throwaway interactive shell.

**NOTE**: The --tty flag prevents redirection of standard output. It combines STDOUT and STDERR, it can insert control characters, and it can hang pipes. This option is only used when run interactively in a terminal. When feeding input to Podman, use -i only, not -it.

echo "asdf" | podman run --rm -i someimage /bin/cat

## **--tz**=_timezone_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#tz-timezone "Link to this heading")

Set timezone in container. This flag takes area-based timezones, GMT time, as well as `local`, which sets the timezone in the container to match the host machine. See `/usr/share/zoneinfo/` for valid timezones. Remote connections use local containers.conf for defaults

## **--uidmap**=_[flags]container\_uid:from\_uid[:amount]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#uidmap-flags-container-uid-from-uid-amount "Link to this heading")

Run the container in a new user namespace using the supplied UID mapping. This option conflicts with the **--userns** and **--subuidname** options. This option provides a way to map host UIDs to container UIDs. It can be passed several times to map different ranges.

The possible values of the optional _flags_ are discussed further down on this page. The _amount_ value is optional and assumed to be **1** if not given.

The _from\_uid_ value is based upon the user running the command, either rootful or rootless users.

- rootful user: [_flags_]_container\_uid_:_host\_uid_[:_amount_]

- rootless user: [_flags_]_container\_uid_:_intermediate\_uid_[:_amount_]

`Rootful mappings`

When **podman run** is called by a privileged user, the option **--uidmap** works as a direct mapping between host UIDs and container UIDs.

host UID -> container UID

The _amount_ specifies the number of consecutive UIDs that is mapped. If for example _amount_ is **4** the mapping looks like:

| host UID        | container UID        |
| --------------- | -------------------- |
| _from\_uid_     | _container\_uid_     |
| _from\_uid_ + 1 | _container\_uid_ + 1 |
| _from\_uid_ + 2 | _container\_uid_ + 2 |
| _from\_uid_ + 3 | _container\_uid_ + 3 |

`Rootless mappings`

When **podman run** is called by an unprivileged user (i.e. running rootless), the value _from\_uid_ is interpreted as an “intermediate UID”. In the rootless case, host UIDs are not mapped directly to container UIDs. Instead the mapping happens over two mapping steps:

host UID -> intermediate UID -> container UID

The **--uidmap** option only influences the second mapping step.

The first mapping step is derived by Podman from the contents of the file _/etc/subuid_ and the UID of the user calling Podman.

First mapping step:

| host UID            | intermediate UID |
| ------------------- | ---------------- |
| UID for Podman user | 0                |
| 1st subordinate UID | 1                |
| 2nd subordinate UID | 2                |
| 3rd subordinate UID | 3                |
| nth subordinate UID | n                |

To be able to use intermediate UIDs greater than zero, the user needs to have subordinate UIDs configured in _/etc/subuid_. See **subuid**(5).

The second mapping step is configured with **--uidmap**.

If for example _amount_ is **5** the second mapping step looks like:

| intermediate UID | container UID        |
| ---------------- | -------------------- |
| _from\_uid_      | _container\_uid_     |
| _from\_uid_ + 1  | _container\_uid_ + 1 |
| _from\_uid_ + 2  | _container\_uid_ + 2 |
| _from\_uid_ + 3  | _container\_uid_ + 3 |
| _from\_uid_ + 4  | _container\_uid_ + 4 |

When running as rootless, Podman uses all the ranges configured in the _/etc/subuid_ file.

The current user ID is mapped to UID=0 in the rootless user namespace. Every additional range is added sequentially afterward:

| host                  | rootless user namespace | length               |
| --------------------- | ----------------------- | -------------------- |
| $UID                  | 0                       | 1                    |
| 1                     | $FIRST_RANGE_ID         | $FIRST_RANGE_LENGTH  |
| 1+$FIRST_RANGE_LENGTH | $SECOND_RANGE_ID        | $SECOND_RANGE_LENGTH |

`Referencing a host ID from the parent namespace`

As a rootless user, the given host ID in **--uidmap** or **--gidmap** is mapped from the _intermediate namespace_ generated by Podman. Sometimes it is desirable to refer directly to the _host namespace_. It is possible to manually do so, by running `podman unshare cat /proc/self/gid_map`, finding the desired host id at the second column of the output, and getting the corresponding intermediate id from the first column.

Podman can perform all that by preceding the host id in the mapping with the `@` symbol. For instance, by specifying `--gidmap 100000:@2000:1`, podman will look up the intermediate id corresponding to host id `2000` and it will map the found intermediate id to the container id `100000`. The given host id must have been subordinated (otherwise it would not be mapped into the intermediate space in the first place).

If the length is greater than one, for instance with `--gidmap 100000:@2000:2`, Podman will map host ids `2000` and `2001` to `100000` and `100001`, respectively, regardless of how the intermediate mapping is defined.

`Extending previous mappings`

Some mapping modifications may be cumbersome. For instance, a user starts with a mapping such as `--gidmap="0:0:65000"`, that needs to be changed such as the parent id `1` is mapped to container id `100000` instead, leaving container id `1` unassigned. The corresponding `--gidmap` becomes `--gidmap="0:0:1" --gidmap="2:2:65534" --gidmap="100000:1:1"`.

This notation can be simplified using the `+` flag, that takes care of breaking previous mappings removing any conflicting assignment with the given mapping. The flag is given before the container id as follows: `--gidmap="0:0:65000" --gidmap="+100000:1:1"`

| Flag | Example       | Description                 |
| ---- | ------------- | --------------------------- |
| `+`  | `+100000:1:1` | Extend the previous mapping |

This notation leads to gaps in the assignment, so it may be convenient to fill those gaps afterwards: `--gidmap="0:0:65000" --gidmap="+100000:1:1" --gidmap="1:65001:1"`

One specific use case for this flag is in the context of rootless users. A rootless user may specify mappings with the `+` flag as in `--gidmap="+100000:1:1"`. Podman will then “fill the gaps” starting from zero with all the remaining intermediate ids. This is convenient when a user wants to map a specific intermediate id to a container id, leaving the rest of subordinate ids to be mapped by Podman at will.

`Passing only one of --uidmap or --gidmap`

Usually, subordinated user and group ids are assigned simultaneously, and for any user the subordinated user ids match the subordinated group ids. For convenience, if only one of **--uidmap** or **--gidmap** is given, podman assumes the mapping refers to both UIDs and GIDs and applies the given mapping to both. If only one value of the two needs to be changed, the mappings should include the `u` or the `g` flags to specify that they only apply to UIDs or GIDs and should not be copied over.

| flag | Example         | Description                      |
| ---- | --------------- | -------------------------------- |
| `u`  | `u20000:2000:1` | The mapping only applies to UIDs |
| `g`  | `g10000:1000:1` | The mapping only applies to GIDs |

For instance given the command

podman run --gidmap "0:0:1000" --gidmap "g2000:2000:1"

Since no **--uidmap** is given, the **--gidmap** is copied to **--uidmap**, giving a command equivalent to

podman run --gidmap "0:0:1000" --gidmap "2000:2000:1" --uidmap "0:0:1000"

The `--gidmap "g2000:2000:1"` used the `g` flag and therefore it was not copied to **--uidmap**.

`Rootless mapping of additional host GIDs`

A rootless user may desire to map a specific host group that has already been subordinated within _/etc/subgid_ without specifying the rest of the mapping.

This can be done with **--gidmap “+g _container\_gid_:@_host\_gid_”**

Where:

- The host GID is given through the `@` symbol

- The mapping of this GID is not copied over to **--usermap** thanks to the `g` flag.

- The rest of the container IDs will be mapped starting from 0 to n, with all the remaining subordinated GIDs, thanks to the `+` flag.

For instance, if a user belongs to the group `2000` and that group is subordinated to that user (with `usermod --add-subgids 2000-2000 $USER`), the user can map the group into the container with: **--gidmap=+g100000:@2000**.

If this mapping is combined with the option, **--group-add=keep-groups**, the process in the container will belong to group `100000`, and files belonging to group `2000` in the host will appear as being owned by group `100000` inside the container.

podman run --group-add=keep-groups --gidmap="+g100000:@2000" ...

`No subordinate UIDs`

Even if a user does not have any subordinate UIDs in _/etc/subuid_, **--uidmap** can be used to map the normal UID of the user to a container UID by running `podman run --uidmap $container_uid:0:1 --user $container_uid ...`.

`Pods`

The **--uidmap** option cannot be called in conjunction with the **--pod** option as a uidmap cannot be set on the container level when in a pod.

## **--ulimit**=_option_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#ulimit-option "Link to this heading")

Ulimit options. Sets the ulimits values inside of the container.

--ulimit with a soft and hard limit in the format =[:]. For example:

$ podman run --ulimit nofile=1024:1024 --rm ubi9 ulimit -n 1024

Set -1 for the soft or hard limit to set the limit to the maximum limit of the current process. In rootful mode this is often unlimited.

If nofile and nproc are unset, a default value of 1048576 will be used, unless overridden in containers.conf(5). However, if the default value exceeds the hard limit for the current rootless user, the current hard limit will be applied instead.

Use **host** to copy the current configuration from the host.

Don’t use nproc with the ulimit flag as Linux uses nproc to set the maximum number of processes available to a user, not to a container.

Use the --pids-limit option to modify the cgroup control to limit the number of processes within a container.

## **--umask**=_umask_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#umask-umask "Link to this heading")

Set the umask inside the container. Defaults to `0022`. Remote connections use the local `containers.conf` for defaults.

## **--unsetenv**=_env_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#unsetenv-env "Link to this heading")

Unset default environment variables for the container. Default environment variables include variables provided natively by Podman, environment variables configured by the image, and environment variables from containers.conf.

## **--unsetenv-all**[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#unsetenv-all "Link to this heading")

Unset all default environment variables for the container. Default environment variables include variables provided natively by Podman, environment variables configured by the image, and environment variables from containers.conf.

## **--user**, **-u**=_user[:group]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#user-u-user-group "Link to this heading")

Sets the username or UID used and, optionally, the groupname or GID for the specified command. Both _user_ and _group_ may be symbolic or numeric.

Without this argument, the command runs as the user specified in the container image. Unless overridden by a `USER` command in the Containerfile or by a value passed to this option, this user generally defaults to root.

When a user namespace is not in use, the UID and GID used within the container and on the host match. When user namespaces are in use, however, the UID and GID in the container may correspond to another UID and GID on the host. In rootless containers, for example, a user namespace is always used, and root in the container by default corresponds to the UID and GID of the user invoking Podman.

## **--userns**=_mode_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#userns-mode "Link to this heading")

Set the user namespace mode for the container.

If `--userns` is not set, the default value is determined as follows.

- If `--pod` is set, `--userns` is ignored and the user namespace of the pod is used.

- If the environment variable **PODMAN_USERNS** is set its value is used.

- If `userns` is specified in `containers.conf` this value is used.

- Otherwise, `--userns=host` is assumed.

`--userns=""` (i.e., an empty string) is an alias for `--userns=host`.

This option is incompatible with **--gidmap**, **--uidmap**, **--subuidname** and **--subgidname**.

Rootless user --userns=Key mappings:

| Key                     | Host User | Container User                                                           |
| ----------------------- | --------- | ------------------------------------------------------------------------ |
| auto                    | $UID      | nil (Host User UID is not mapped into container.)                        |
| host                    | $UID      | 0 (Default User account mapped to root user in container.)               |
| keep-id                 | $UID      | $UID (Map user account to same UID within container.)                    |
| keep-id:uid=200,gid=210 | $UID      | 200:210 (Map user account to specified UID, GID value within container.) |
| nomap                   | $UID      | nil (Host User UID is not mapped into container.)                        |

Valid _mode_ values are:

**auto**[:_OPTIONS,…_]: automatically create a unique user namespace.

- `rootful mode`: The `--userns=auto` flag requires that the user name **containers** be specified in the /etc/subuid and /etc/subgid files, with an unused range of subordinate user IDs that Podman containers are allowed to allocate. Example: `containers:2147483647:2147483648`.

- `rootless mode`: The users range from the /etc/subuid and /etc/subgid files will be used. Note running a single container without using --userns=auto will use the entire range of UIDs and not allow further subdividing. See subuid(5).

Podman allocates unique ranges of UIDs and GIDs from the `containers` subordinate user IDs. The size of the ranges is based on the number of UIDs required in the image. The number of UIDs and GIDs can be overridden with the `size` option.

The option `--userns=keep-id` uses all the subuids and subgids of the user. The option `--userns=nomap` uses all the subuids and subgids of the user except the user’s own ID. Using `--userns=auto` when starting new containers does not work as long as any containers exist that were started with `--userns=nomap` or `--userns=keep-id` without limiting the user namespace size.

Valid `auto` options:

- _gidmapping_=_CONTAINER\_GID:HOST\_GID:SIZE_: to force a GID mapping to be present in the user namespace.

- _size_=_SIZE_: to specify an explicit size for the automatic user namespace. e.g. `--userns=auto:size=8192`. If `size` is not specified, `auto` estimates a size for the user namespace.

- _uidmapping_=_CONTAINER\_UID:HOST\_UID:SIZE_: to force a UID mapping to be present in the user namespace.

The host UID and GID in _gidmapping_ and _uidmapping_ can optionally be prefixed with the `@` symbol. In this case, podman will look up the intermediate ID corresponding to host ID and it will map the found intermediate ID to the container id. For details see **--uidmap**.

**container:**_id_: join the user namespace of the specified container.

**host** or **“”** (empty string): run in the user namespace of the caller. The processes running in the container have the same privileges on the host as any other process launched by the calling user.

**keep-id**: creates a user namespace where the current user’s UID:GID are mapped to the same values in the container. For containers created by root, the current mapping is created into a new user namespace.

In addition, the init process within the container will run under the current user’s UID. This behavior overrides the image’s `USER` instruction unless you explicitly set `--user`.

Valid `keep-id` options:

- _uid_=UID: override the UID inside the container that is used to map the current user to.

- _gid_=GID: override the GID inside the container that is used to map the current user to.

- _size_=SIZE: override the size of the configured user namespace. It is useful to not saturate all the available IDs. Not supported when running as root.

**nomap**: creates a user namespace where the current rootless user’s UID:GID are not mapped into the container. This option is not allowed for containers created by the root user.

**ns:**_namespace_: run the container in the given existing user namespace.

## **--uts**=_mode_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#uts-mode "Link to this heading")

Set the UTS namespace mode for the container. The following values are supported:

- **host**: use the host’s UTS namespace inside the container.

- **private**: create a new namespace for the container (default).

- **ns:[path]**: run the container in the given existing UTS namespace.

- **container:[container]**: join the UTS namespace of the specified container.

## **--variant**=_VARIANT_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#variant-variant "Link to this heading")

Use _VARIANT_ instead of the default architecture variant of the container image. Some images can use multiple variants of the arm architectures, such as arm/v5 and arm/v7.

## **--volume**, **-v**=_[[SOURCE-VOLUME|HOST-DIR:]CONTAINER-DIR[:OPTIONS]]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#volume-v-source-volume-host-dir-container-dir-options "Link to this heading")

Create a bind mount. If `-v /HOST-DIR:/CONTAINER-DIR` is specified, Podman bind mounts `/HOST-DIR` from the host into `/CONTAINER-DIR` in the Podman container. Similarly, `-v SOURCE-VOLUME:/CONTAINER-DIR` mounts the named volume from the host into the container. If no such named volume exists, Podman creates one. The **nocreate** option can be used to disable this behavior and require the volume to already exist. If no source is given, the volume is created as an anonymously named volume with a randomly generated name, and is removed when the container is removed via the `--rm` flag or the `podman rm --volumes` command.

(Note when using the remote client, including Mac and Windows (excluding WSL2) machines, the volumes are mounted from the remote server, not necessarily the client machine.)

The _OPTIONS_ is a comma-separated list and can be one or more of:

- **rw**|**ro**

- **z**|**Z**

- [**O**]

- [**U**]

- [**no**]**copy**

- [**no**]**dev**

- [**no**]**exec**

- [**no**]**suid**

- [**r**]**bind**

- [**r**]**shared**|[**r**]**slave**|[**r**]**private**[**r**]**unbindable**[[1]](https://docs.podman.io/en/latest/markdown/podman-run.1.html#Footnote1)

- **idmap**[=**options**]

- **nocreate**

The `CONTAINER-DIR` must be an absolute path such as `/src/docs`. The volume is mounted into the container at this directory.

If a volume source is specified, it must be a path on the host or the name of a named volume. Host paths are allowed to be absolute or relative; relative paths are resolved relative to the directory Podman is run in. If the source does not exist, Podman returns an error. Users must pre-create the source files or directories.

Any source that does not begin with a `.` or `/` is treated as the name of a named volume. If a volume with that name does not exist, it is created. Volumes created with names are not anonymous, and they are not removed by the `--rm` option and the `podman rm --volumes` command.

The **nocreate** option can be specified for named volumes to prevent automatic volume creation. If **nocreate** is set and the volume does not exist, Podman returns an error instead of creating the volume. This is useful when you want to ensure that a volume was explicitly created before use.

$ podman run -v myvolume:/data:nocreate alpine

Specify multiple **-v** options to mount one or more volumes into a container.

`Write Protected Volume Mounts`

Add **:ro** or **:rw** option to mount a volume in read-only or read-write mode, respectively. By default, the volumes are mounted read-write. See examples.

`Chowning Volume Mounts`

When a named volume is first mounted to a container, Podman automatically adjusts the ownership of the volume’s mount point during container initialization. This chown operation occurs under the following conditions:

- The volume was not used yet (has `NeedsChown` set to true)

- The volume is empty or has not been copied up yet

- The volume is not managed by an external volume driver

- The volume driver is not “image”

For volumes with idmapped mounts (using the `idmap` option), the ownership change takes into account the container’s user namespace mappings, but the idmapped volume retains proper UID/GID mapping. For volumes without idmapping, the mount point is chowned to match the container’s process user and group, mapped to the host user namespace if user namespace remapping is enabled.

If a container is created in a new user namespace, the UID and GID in the container may correspond to another UID and GID on the host.

The `:U` suffix tells Podman to use the correct host UID and GID based on the UID and GID within the container, to change recursively the owner and group of the source volume. Chowning walks the file system under the volume and changes the UID/GID on each file. If the volume has thousands of inodes, this process takes a long time, delaying the start of the container.

**Warning** use with caution since this modifies the host filesystem.

`Labeling Volume Mounts`

Labeling systems like SELinux require that proper labels are placed on volume content mounted into a container. Without a label, the security system might prevent the processes running inside the container from using the content. By default, Podman does not change the labels set by the OS.

To change a label in the container context, add either of two suffixes **:z** or **:Z** to the volume mount. These suffixes tell Podman to relabel file objects on the shared volumes. The **z** option tells Podman that two or more containers share the volume content. As a result, Podman labels the content with a shared content label. Shared volume labels allow all containers to read/write content. The **Z** option tells Podman to label the content with a private unshared label. Only the current container can use a private volume.

Note: all containers within a `pod` share the same SELinux label. This means all containers within said pod can read/write volumes shared into the container created with the `:Z` on any one of the containers. Relabeling walks the file system under the volume and changes the label on each file; if the volume has thousands of inodes, this process takes a long time, delaying the start of the container. If the volume was previously relabeled with the `z` option, Podman is optimized to not relabel a second time. If files are moved into the volume, then the labels can be manually changed with the `chcon -Rt container_file_t PATH` command.

Note: Do not relabel system files and directories. Relabeling system content might cause other confined services on the machine to fail. For these types of containers we recommend disabling SELinux separation. The option **--security-opt label=disable** disables SELinux separation for the container. For example if a user wanted to volume mount their entire home directory into a container, they need to disable SELinux separation.

$ podman run --security-opt label=disable -v $HOME:/home/user fedora touch /home/user/file

`Overlay Volume Mounts`

The `:O` flag tells Podman to mount the directory from the host as a temporary storage using the `overlay file system`. The container processes can modify content within the mountpoint which is stored in the container storage in a separate directory. In overlay terms, the source directory is the lower, and the container storage directory is the upper. Modifications to the mount point are destroyed when the container finishes executing, similar to a tmpfs mount point being unmounted.

For advanced users, the **overlay** option also supports custom non-volatile **upperdir** and **workdir** for the overlay mount. Custom **upperdir** and **workdir** can be fully managed by the users themselves, and Podman does not remove it on lifecycle completion. Example **:O,upperdir=/some/upper,workdir=/some/work**

Subsequent executions of the container sees the original source directory content, any changes from previous container executions no longer exist.

One use case of the overlay mount is sharing the package cache from the host into the container to allow speeding up builds.

Note: The `O` flag conflicts with other options listed above.

Content mounted into the container is labeled with the private label. On SELinux systems, labels in the source directory must be readable by the container label. Usually containers can read/execute `container_share_t` and can read/write `container_file_t`. If unable to change the labels on a source volume, SELinux container separation must be disabled for the container to work.

Do not modify the source directory mounted into the container with an overlay mount, it can cause unexpected failures. Only modify the directory after the container finishes running.

`Mounts propagation`

By default, bind-mounted volumes are `private`. That means any mounts done inside the container are not visible on the host and vice versa. One can change this behavior by specifying a volume mount propagation property. When a volume is `shared`, mounts done under that volume inside the container are visible on host and vice versa. Making a volume **slave**[[1]](https://docs.podman.io/en/latest/markdown/podman-run.1.html#Footnote1) enables only one-way mount propagation: mounts done on the host under that volume are visible inside the container but not the other way around.

To control mount propagation property of a volume one can use the [**r**]**shared**, [**r**]**slave**, [**r**]**private** or the [**r**]**unbindable** propagation flag. Propagation property can be specified only for bind mounted volumes and not for internal volumes or named volumes. For mount propagation to work the source mount point (the mount point where source dir is mounted on) has to have the right propagation properties. For shared volumes, the source mount point has to be shared. And for slave volumes, the source mount point has to be either shared or slave. [[1]](https://docs.podman.io/en/latest/markdown/podman-run.1.html#Footnote1)

To recursively mount a volume and all of its submounts into a container, use the **rbind** option. By default the bind option is used, and submounts of the source directory is not mounted into the container.

Mounting the volume with a **copy** option tells podman to copy content from the underlying destination directory onto newly created internal volumes. The **copy** only happens on the initial creation of the volume. Content is not copied up when the volume is subsequently used on different containers. The **copy** option is ignored on bind mounts and has no effect.

Mounting volumes with the **nosuid** options means that SUID executables on the volume can not be used by applications to change their privilege. By default volumes are mounted with **nosuid**.

Mounting the volume with the **noexec** option means that no executables on the volume can be executed within the container.

Mounting the volume with the **nodev** option means that no devices on the volume can be used by processes within the container. By default volumes are mounted with **nodev**.

If the _HOST-DIR_ is a mount point, then **dev**, **suid**, and **exec** options are ignored by the kernel.

Use **df HOST-DIR** to figure out the source mount, then use **findmnt -o TARGET,PROPAGATION _source-mount-dir_** to figure out propagation properties of source mount. If **findmnt**(1) utility is not available, then one can look at the mount entry for the source mount point in _/proc/self/mountinfo_. Look at the “optional fields” and see if any propagation properties are specified. In there, **shared:N** means the mount is shared, **master:N** means mount is slave, and if nothing is there, the mount is private. [[1]](https://docs.podman.io/en/latest/markdown/podman-run.1.html#Footnote1)

To change propagation properties of a mount point, use **mount**(8) command. For example, if one wants to bind mount source directory _/foo_, one can do **mount --bind /foo /foo** and **mount --make-private --make-shared /foo**. This converts /foo into a shared mount point. Alternatively, one can directly change propagation properties of source mount. Say _/_ is source mount for _/foo_, then use **mount --make-shared /** to convert _/_ into a shared mount.

Note: if the user only has access rights via a group, accessing the volume from inside a rootless container fails.

`Idmapped mount`

If `idmap` is specified, create an idmapped mount to the target user namespace in the container. The idmap option supports a custom mapping that can be different than the user namespace used by the container. The mapping can be specified after the idmap option like: `idmap=uids=0-1-10#10-11-10;gids=0-100-10`. For each triplet, the first value is the start of the backing file system IDs that are mapped to the second value on the host. The length of this mapping is given in the third value. Multiple ranges are separated with #.

Use the **--group-add keep-groups** option to pass the user’s supplementary group access into the container.

## **--volumes-from**=_CONTAINER[:OPTIONS]_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#volumes-from-container-options "Link to this heading")

Mount volumes from the specified container(s). Used to share volumes between containers. The _options_ is a comma-separated list with the following available elements:

- **rw**|**ro**

- **z**

Mounts already mounted volumes from a source container onto another container. _CONTAINER_ may be a name or ID. To share a volume, use the --volumes-from option when running the target container. Volumes can be shared even if the source container is not running.

By default, Podman mounts the volumes in the same mode (read-write or read-only) as it is mounted in the source container. This can be changed by adding a `ro` or `rw`_option_.

Labeling systems like SELinux require that proper labels are placed on volume content mounted into a container. Without a label, the security system might prevent the processes running inside the container from using the content. By default, Podman does not change the labels set by the OS.

To change a label in the container context, add `z` to the volume mount. This suffix tells Podman to relabel file objects on the shared volumes. The `z` option tells Podman that two entities share the volume content. As a result, Podman labels the content with a shared content label. Shared volume labels allow all containers to read/write content.

If the location of the volume from the source container overlaps with data residing on a target container, then the volume hides that data on the target.

## **--workdir**, **-w**=_dir_[¶](https://docs.podman.io/en/latest/markdown/podman-run.1.html#workdir-w-dir "Link to this heading")

Working directory inside the container.

The default working directory for running binaries within a container is the root directory (**/**). The image developer can set a different default with the WORKDIR instruction. The operator can override the working directory by using the **-w** option.
