import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PUT_URL_TTL_SECONDS = 15 * 60;
const GET_URL_TTL_SECONDS = 15 * 60;

// Thin S3 wrapper pointed at any S3-compatible endpoint (MinIO locally, real
// S3 in prod — forcePathStyle is the only MinIO-ism). Presigning is local
// SigV4 computation, not a network call, so per-attachment GET URLs on message
// reads are cheap.
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.get<string>("S3_BUCKET")!;
    this.client = new S3Client({
      endpoint: config.get<string>("S3_ENDPOINT"),
      region: config.get<string>("S3_REGION"),
      credentials: {
        accessKeyId: config.get<string>("S3_ACCESS_KEY")!,
        secretAccessKey: config.get<string>("S3_SECRET_KEY")!,
      },
      forcePathStyle: true,
    });
  }

  // Dev convenience: create the bucket on boot if missing. In prod the bucket
  // is provisioned infrastructure and this is a no-op existence check.
  async onModuleInit() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`created bucket ${this.bucket}`);
    }
  }

  presignPut(key: string, contentType: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: PUT_URL_TTL_SECONDS },
    );
  }

  presignGet(key: string, downloadName: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `inline; filename="${encodeURIComponent(downloadName)}"`,
      }),
      { expiresIn: GET_URL_TTL_SECONDS },
    );
  }

  // Returns the real stored size, or null if the object doesn't exist.
  async objectSize(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? 0;
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => undefined);
  }

  get putUrlTtlSeconds() {
    return PUT_URL_TTL_SECONDS;
  }
}
