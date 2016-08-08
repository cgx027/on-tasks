// Copyright 2015, EMC, Inc.
/* jshint node:true */

'use strict';

var uuid = require('node-uuid');

describe('Install OS Job', function () {
    var InstallOsJob;
    var subscribeRequestProfileStub;
    var subscribeRequestPropertiesStub;
    var subscribeHttpResponseStub;
    var subscribeTaskNotification;
    var doneSpy;
    var job;
    var waterline;
    var Promise;
    var logger;
    var loggerSpy;

    before(function() {
        helper.setupInjector(
            _.flattenDeep([
                helper.require('/lib/jobs/base-job'),
                helper.require('/lib/jobs/install-os'),
                helper.require('/lib/utils/job-utils/catalog-searcher'),
                helper.di.simpleWrapper({ catalogs:  {} }, 'Services.Waterline')
            ])
        );

        InstallOsJob = helper.injector.get('Job.Os.Install');
        waterline = helper.injector.get('Services.Waterline');
        logger = helper.injector.get('Logger');
        Promise = helper.injector.get('Promise');
        subscribeRequestProfileStub = sinon.stub(
            InstallOsJob.prototype, '_subscribeRequestProfile');
        subscribeRequestPropertiesStub = sinon.stub(
            InstallOsJob.prototype, '_subscribeRequestProperties');
        subscribeHttpResponseStub = sinon.stub(
            InstallOsJob.prototype, '_subscribeHttpResponse');
        subscribeTaskNotification = sinon.stub(
            InstallOsJob.prototype, '_subscribeTaskNotification');
        doneSpy = sinon.spy(InstallOsJob.prototype, '_done');
    });

    beforeEach(function() {
        subscribeRequestProfileStub.reset();
        subscribeRequestPropertiesStub.reset();
        subscribeHttpResponseStub.reset();
        doneSpy.reset();
        job = new InstallOsJob(
            {
                profile: 'testprofile',
                completionUri: 'testCompletion',
                version: '7.0',
                repo: 'http://127.0.0.1:8080/myrepo/7.0/x86_64',
                rootPassword: 'rackhd',
                rootSshKey: 'testkey',
                kvm: null,
                users: [
                    {
                        name: 'test',
                        password: 'testPassword',
                        uid: 600,
                        sshKey: ''
                    }
                ],
                dnsServers: null
            },
            {
                target: 'testid'
            },
            uuid.v4());
    });

    after(function() {
        subscribeRequestProfileStub.restore();
        subscribeRequestPropertiesStub.restore();
        subscribeHttpResponseStub.restore();
        doneSpy.restore();
    });

    it("should have a nodeId value", function() {
        expect(job.nodeId).to.equal('testid');
    });

    it("should have a profile value", function() {
        expect(job.profile).to.equal('testprofile');
    });

    it("should generate correct password", function() {
        expect(job.options.rootEncryptedPassword).to.match(/^\$6\$*\$*/);
        expect(job.options.users[0].encryptedPassword).to.match(/^\$6\$*\$*/);
    });

    it("should preserve an existing/positive kvm flag", function() {
        var jobWithKVM = new InstallOsJob(
            {
                profile: 'testprofile',
                completionUri: '',
                version: '7.0',
                repo: 'http://127.0.0.1:8080/myrepo/7.0/x86_64',
                rootPassword: 'rackhd',
                rootSshKey: 'testkey',
                kvm: true,
                users: [
                    {
                        name: 'test',
                        password: 'testPassword',
                        uid: 600,
                        sshKey: ''
                    }
                ],
                dnsServers: null
            },
            {
                target: 'testid'
            },
            uuid.v4());
        expect(jobWithKVM.options).to.have.property('kvm');
        expect(jobWithKVM.options.kvm).to.equal(true);
    });


    it("should set up message subscribers", function() {
        var cb;
        waterline.catalogs.findMostRecent = sinon.stub().resolves({});
        return job._run().then(function() {
            expect(subscribeRequestProfileStub).to.have.been.called;
            expect(subscribeRequestPropertiesStub).to.have.been.called;
            expect(subscribeHttpResponseStub).to.have.been.called;
            expect(subscribeTaskNotification).to.have.been.called;

            cb = subscribeRequestProfileStub.firstCall.args[0];
            expect(cb).to.be.a('function');
            expect(cb.call(job)).to.equal(job.profile);

            cb = subscribeRequestPropertiesStub.firstCall.args[0];
            expect(cb).to.be.a('function');
            expect(cb.call(job)).to.equal(job.options);

            cb = subscribeHttpResponseStub.firstCall.args[0];
            expect(cb).to.be.a('function');

            var taskId = subscribeTaskNotification.firstCall.args[0];
            expect(taskId).to.be.a('string');
            cb = subscribeTaskNotification.firstCall.args[1];
            expect(cb).to.be.a('function');

        });
    });

    it('should finish job if http response has expected completionUri', function() {
        subscribeHttpResponseStub.restore();
        subscribeHttpResponseStub = sinon.stub(
            InstallOsJob.prototype, '_subscribeHttpResponse', function(callback) {
                callback({
                    statusCode: 200,
                    url: 'http://172.31.128.1:9080/foo/bar/testCompletion'
                });
            });
        return job._run().then(function() {
            expect(subscribeHttpResponseStub).to.have.callCount(1);
            expect(job._done).to.have.callCount(1);
            expect(job._done.firstCall.args[0]).to.equal(undefined);
        });
    });

    it('should not finish job if http response has bad http statusCode', function() {
        subscribeHttpResponseStub.restore();
        subscribeHttpResponseStub = sinon.stub(
            InstallOsJob.prototype, '_subscribeHttpResponse', function(callback) {
                callback({
                    statusCode: 400,
                    url: 'http://172.31.128.1:9080/foo/bar/testCompletion'
                });
            });
        return job._run().then(function() {
            expect(subscribeHttpResponseStub).to.have.callCount(1);
            expect(job._done).to.have.not.been.called;
        });
    });

    it('should not finish job if http response has no expected completionUri', function() {
        subscribeHttpResponseStub.restore();
        subscribeHttpResponseStub = sinon.stub(
            InstallOsJob.prototype, '_subscribeHttpResponse', function(callback) {
                callback({
                    statusCode: 200,
                    url: 'http://172.31.128.1:9080/foo/bar/test123'
                });
            });
        return job._run().then(function() {
            expect(subscribeHttpResponseStub).to.have.callCount(1);
            expect(job._done).to.have.not.been.called;
        });
    });

    it('should finish job if task notification has expect complete status', function() {
        subscribeTaskNotification.restore();
        subscribeTaskNotification = sinon.stub(
            InstallOsJob.prototype, '_subscribeTaskNotification', function(_taskId, callback) {
                callback({
                    taskId: job.taskId,
                    data: {
                        status: 'completed'
                    }
                });
            });
        return job._run().then(function() {
            expect(subscribeHttpResponseStub).to.have.callCount(1);
            expect(job._done).to.have.callCount(1);
            expect(job._done.firstCall.args[0]).to.equal(undefined);
        });
    });

    it('should not finish job if task notification has ongoing status', function() {
        subscribeTaskNotification.restore();
        subscribeTaskNotification = sinon.stub(
            InstallOsJob.prototype, '_subscribeTaskNotification', function(_taskId, callback) {
                callback({
                    taskId: job.taskId,
                    data: {
                        status: 'inProgress',
                        progress: 'osInstalled'
                    }
                });
            });
        loggerSpy = sinon.stub(logger.prototype, 'info').resolves({});
        return job._run().then(function() {
            expect(subscribeHttpResponseStub).to.have.callCount(1);
            expect(job._done).to.have.not.been.called;
            expect(loggerSpy).to.have.callCount(1);
        });
    });

    it('should provide the given user credentials to the context', function() {
        expect(job.context.users).to.deep.equal(
            job.options.users.concat({name: 'root', password: 'rackhd', privateKey: 'testkey'})
        );
    });

    describe('test _convertInstallDisk', function() {
        var catalog = {
            data: [
                {
                    identifier: 0,
                    linuxWwid: '/dev/test0',
                    esxiWwid: 't10.abcde'
                },
                {
                    identifier: 1,
                    linuxWwid: '/dev/test1',
                    esxiWwid: 'naa.rstuvw'
                },
                {
                    identifier: 2,
                    linuxWwid: '/dev/test2',
                    esxiWwid: 'naa.xyzopq'
                }
            ]
        };

        beforeEach(function() {
            job = new InstallOsJob(
                {
                    profile: 'testprofile',
                    completionUri: '',
                    version: '7.0',
                    repo: 'http://127.0.0.1:8080/myrepo/7.0/x86_64',
                    rootPassword: 'rackhd',
                    rootSshKey: 'testkey',
                    users: [
                        {
                            name: 'test',
                            password: 'testPassword',
                            uid: 600,
                            sshKey: ''
                        }
                    ],
                    dnsServers: null,
                    installDisk: 1,
                    osType: 'esx'
                },
                {
                    target: 'testid'
                },
                uuid.v4());
            waterline.catalogs.findMostRecent = sinon.stub().resolves(catalog);
        });

        afterEach(function() {
            waterline.catalogs.findMostRecent.reset();
        });

        it('should set correct installDisk esxi wwid', function() {
            return job._convertInstallDisk().then(function() {
                expect(job.options.installDisk).to.equal('naa.rstuvw');
            });
        });

        it('should set correct installDisk linux wwid', function() {
            job.options.osType = 'linux';
            return job._convertInstallDisk().then(function() {
                expect(job.options.installDisk).to.equal('/dev/test1');
            });
        });

        it('should not convert if installDisk is string', function() {
            job.options.osType = 'linux';
            job.options.installDisk = 'wwidabcd';
            return job._convertInstallDisk().then(function() {
                expect(job.options.installDisk).to.equal('wwidabcd');
            });
        });

        it('should not convert if installDisk is not either string or number', function() {
            job.options.osType = 'linux';
            job.options.installDisk = [1, 2];
            return expect(job._convertInstallDisk()).to.be.rejectedWith(Error);
        });

        it('should set SATADOM wwid as default if installDisk is not specified', function() {
            job.options.installDisk = null;
            return job._convertInstallDisk().then(function() {
                expect(job.options.installDisk).to.equal('t10.abcde');
            });
        });

        it('should do conversion if installDisk is 0 (for ESXi)', function() {
            job.options.osType = 'esx';
            job.options.installDisk = 0;
            return job._convertInstallDisk().then(function() {
                expect(job.options.installDisk).to.equal('t10.abcde');
            });
        });

        it('should do conversion if installDisk is 0 (for Linux)', function() {
            job.options.osType = 'linux';
            job.options.installDisk = 0;
            return job._convertInstallDisk().then(function() {
                expect(job.options.installDisk).to.equal('/dev/test0');
            });
        });

        it('should reject when installDisk is Number but not exist', function() {
            job.options.installDisk = 100;
            return expect(job._convertInstallDisk()).to.be.rejectedWith(Error);
        });

        it('should set sda if installDisk is null and catalog is empty (Linux)', function() {
            job.options.osType = 'linux';
            job.options.installDisk = null;
            waterline.catalogs.findMostRecent = sinon.stub().resolves({});
            return job._convertInstallDisk().then(function() {
                expect(job.options.installDisk).to.equal('sda');
            });
        });

        it('should set firstdisk if installDisk is null and catalog is empty (ESXi)', function() {
            job.options.osType = 'esx';
            job.options.installDisk = null;
            waterline.catalogs.findMostRecent = sinon.stub().resolves({});
            return job._convertInstallDisk().then(function() {
                expect(job.options.installDisk).to.equal('firstdisk');
            });
        });
    });

    describe('test _validateOptions', function() {
        it('should throw ipAddr AssertionError', function () {
            job.options.networkDevices = [
                {
                    device: "eth0",
                    ipv4:{
                        ipAddr: '292.168.1.1',
                        gateway: "192.168.1.1",
                        netmask: "255.255.255.0"
                    }
                }
            ];
            expect(function() { job._validateOptions(); })
                .to.throw(Error.AssertionError, 'Violated isIP constraint');
        });

        it('should throw netmask AssertionError', function () {
            job.options.networkDevices = [
                {
                    device: "eth0",
                    ipv4:{
                        ipAddr: '192.168.1.1',
                        gateway: '192.168.1.1',
                        netmask: '255.255.192.1'
                    }
                }
            ];
            expect(function() { job._validateOptions(); })
                .to.throw(Error.AssertionError, 'Invalid ipv4 netmask.');
        });

        it('should throw ipAddress AssertionError', function () {
            job.options.networkDevices = [
                {
                    device: "eth0",
                    ipv6:{
                        ipAddr: "10ec0::6ab4:0:5efe:157.60.14.21",
                        gateway: "fe80::5efe:131.107.25.1",
                        netmask: "ffff.ffff.ffff.ffff.0.0.1.0"
                    }
                }
            ];
            expect(function() { job._validateOptions(); })
                .to.throw(Error.AssertionError, 'Violated isIP constraint');
        });

        it('should throw netmask AssertionError', function () {
            job.options.networkDevices = [
                {
                    device: "eth0",
                    ipv6:{
                        ipAddr: "fec0::6ab4:0:5efe:157.60.14.21",
                        gateway: "fe80::5efe:131.107.25.1",
                        netmask: "ffff.ffff.ffff.ffff.0.0.1.0"
                    }
                }
            ];
            expect(function() { job._validateOptions(); })
                .to.throw(Error, 'Invalid ipv6 netmask.');
        });

        it('should throw error when size is not a number string and not "auto"', function() {
            job.options.installPartitions = [{ mountPoint:'/boot', size:"abc", fsType:'ext3' }];
            return expect(job._validateOptions.bind(job,{}))
                   .to.throw('size must be a number string or "auto"');
        });


        it('should correct fsType when mountPoint is swap but fsType is not swap', function() {
            job.options.installPartitions = [{ mountPoint:'swap', size:'500', fsType:'ext3' }];
            job._validateOptions.bind(job,{})();
            expect(job.options.installPartitions[0].fsType).to.equal('swap');
        });

    });
});
