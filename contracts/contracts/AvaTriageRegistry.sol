// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title AvaTriageRegistry
 * @notice On-chain attestation registry for AI-powered Smart Contract Vulnerability Triage on Avalanche.
 * @dev Records immutable audit report hashes and Tri-Pillar priority scores (0-100)
 *      submitted voluntarily by users via their Web3 wallets.
 */
contract AvaTriageRegistry {
    uint256 public constant MAX_PRIORITY_SCORE = 100;
    uint256 public constant MAX_IPFS_URI_LENGTH = 512;

    struct Attestation {
        uint256 id;
        address targetContract;
        address auditor;
        bytes32 reportHash;
        uint256 priorityScore;
        string ipfsUri;
        uint256 timestamp;
    }

    Attestation[] private _attestations;
    mapping(address => uint256[]) private _targetAttestationIds;
    mapping(address => mapping(address => mapping(bytes32 => bool))) public hasAttested;

    event AttestationRecorded(
        uint256 indexed attestationId,
        address indexed targetContract,
        address indexed auditor,
        bytes32 reportHash,
        uint256 priorityScore,
        string ipfsUri,
        uint256 timestamp
    );

    error ZeroAddress();
    error InvalidReportHash();
    error InvalidPriorityScore(uint256 score);
    error IpfsUriTooLong(uint256 length, uint256 maxLength);
    error DuplicateAttestation(address auditor, address targetContract, bytes32 reportHash);
    error AttestationNotFound(uint256 attestationId);
    error NoAttestationsForTarget(address targetContract);

    /**
     * @notice Record a vulnerability triage attestation on-chain.
     * @param targetContract Address of the audited smart contract (non-zero).
     * @param reportHash Keccak256 / SHA-256 digest of the canonical triage report JSON (non-zero).
     * @param priorityScore Composite Tri-Pillar priority score normalized to 0..100.
     * @param ipfsUri Optional IPFS/Arweave URI pointing to the full report (max 512 bytes).
     * @return attestationId The sequential ID of the newly recorded attestation.
     */
    function recordAttestation(
        address targetContract,
        bytes32 reportHash,
        uint256 priorityScore,
        string calldata ipfsUri
    ) external returns (uint256 attestationId) {
        if (targetContract == address(0)) {
            revert ZeroAddress();
        }
        if (reportHash == bytes32(0)) {
            revert InvalidReportHash();
        }
        if (priorityScore > MAX_PRIORITY_SCORE) {
            revert InvalidPriorityScore(priorityScore);
        }
        uint256 uriLength = bytes(ipfsUri).length;
        if (uriLength > MAX_IPFS_URI_LENGTH) {
            revert IpfsUriTooLong(uriLength, MAX_IPFS_URI_LENGTH);
        }
        if (hasAttested[msg.sender][targetContract][reportHash]) {
            revert DuplicateAttestation(msg.sender, targetContract, reportHash);
        }

        hasAttested[msg.sender][targetContract][reportHash] = true;
        attestationId = _attestations.length;

        _attestations.push(
            Attestation({
                id: attestationId,
                targetContract: targetContract,
                auditor: msg.sender,
                reportHash: reportHash,
                priorityScore: priorityScore,
                ipfsUri: ipfsUri,
                timestamp: block.timestamp
            })
        );

        _targetAttestationIds[targetContract].push(attestationId);

        emit AttestationRecorded(
            attestationId,
            targetContract,
            msg.sender,
            reportHash,
            priorityScore,
            ipfsUri,
            block.timestamp
        );
    }

    /**
     * @notice Returns the total number of recorded attestations.
     */
    function totalAttestations() external view returns (uint256) {
        return _attestations.length;
    }

    /**
     * @notice Fetches a single attestation by its sequential ID.
     */
    function getAttestation(uint256 attestationId) external view returns (Attestation memory) {
        if (attestationId >= _attestations.length) {
            revert AttestationNotFound(attestationId);
        }
        return _attestations[attestationId];
    }

    /**
     * @notice Returns all attestation IDs recorded for a given target contract.
     */
    function getAttestationIdsByTarget(address targetContract) external view returns (uint256[] memory) {
        return _targetAttestationIds[targetContract];
    }

    /**
     * @notice Returns the most recent attestation for a given target contract.
     */
    function getLatestAttestation(address targetContract) external view returns (Attestation memory) {
        uint256[] storage ids = _targetAttestationIds[targetContract];
        if (ids.length == 0) {
            revert NoAttestationsForTarget(targetContract);
        }
        return _attestations[ids[ids.length - 1]];
    }
}

